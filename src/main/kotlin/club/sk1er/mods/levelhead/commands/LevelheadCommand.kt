package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.commands.WhoisService
import club.sk1er.mods.levelhead.config.ConfigProfiles
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.await
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.commands.WhoisService.CommandException
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Greedy
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import cc.polyfrost.oneconfig.utils.commands.annotations.SubCommand
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.GuiScreen
import net.minecraft.event.ClickEvent
import net.minecraft.event.HoverEvent
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
import net.minecraft.util.IChatComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.minecraft.entity.player.EntityPlayer
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.commands.PlayerIdentifiers
import club.sk1er.mods.levelhead.commands.CommandUtils
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.awt.Color
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.text.RegexOption

@Command(value = "levelhead", aliases = ["lh"])
class LevelheadCommand {


    @SubCommand
    fun confirm() {
        val action = pendingAction
        if (action == null) {
            sendMessage("§cNo pending action to confirm.")
            return
        }
        pendingAction = null
        action()
    }


    companion object {
        private val API_KEY_PATTERN = Regex("^[a-f0-9]{32}$", RegexOption.IGNORE_CASE)
        private val HEX_COLOR_PATTERN = Regex("^#?[0-9a-fA-F]{6}$")
        private val RGB_COLOR_PATTERN = Regex("^(\\d{1,3}),(\\d{1,3}),(\\d{1,3})$")
        private const val MIN_DISPLAY_OFFSET = -1.5
        private const val MAX_DISPLAY_OFFSET = 3.0
        private val JSON_MEDIA_TYPE: MediaType = MediaType.parse("application/json; charset=utf-8")
            ?: error("Failed to initialise JSON media type")
        private const val APIKEY_COMMAND = "/levelhead apikey <key>"
        private const val APIKEY_SUGGESTION = "/levelhead apikey "
        private val NAMED_COLORS: Map<String, Color> = mapOf(
            "black" to Color(0, 0, 0),
            "dark_blue" to Color(0, 0, 170),
            "dark_green" to Color(0, 170, 0),
            "dark_aqua" to Color(0, 170, 170),
            "dark_red" to Color(170, 0, 0),
            "dark_purple" to Color(170, 0, 170),
            "gold" to Color(255, 170, 0),
            "gray" to Color(170, 170, 170),
            "dark_gray" to Color(85, 85, 85),
            "blue" to Color(85, 85, 255),
            "green" to Color(85, 255, 85),
            "aqua" to Color(85, 255, 255),
            "red" to Color(255, 85, 85),
            "light_purple" to Color(255, 85, 255),
            "yellow" to Color(255, 255, 85),
            "white" to Color(255, 255, 255)
        )
    }

    @Main
    fun handle() {
        val enabled = Levelhead.displayManager.config.enabled
        val enabledColor = if (enabled) ChatColor.GREEN else ChatColor.RED
        val primaryDisplay = Levelhead.displayManager.primaryDisplay()
        val header = primaryDisplay?.config?.headerString ?: GameMode.BEDWARS.defaultHeader
        val showSelf = primaryDisplay?.config?.showSelf ?: true
        val offset = Levelhead.displayManager.config.offset
        val proxyState = when {
            !LevelheadConfig.proxyEnabled -> "${ChatColor.GRAY}disabled"
            LevelheadConfig.proxyBaseUrl.isBlank() || LevelheadConfig.proxyAuthToken.isBlank() -> "${ChatColor.RED}misconfigured"
            else -> "${ChatColor.GREEN}configured"
        }

        val statusText = if (enabled) "enabled" else "disabled"
        val toggleCmd = if (enabled) "/levelhead disable" else "/levelhead enable"
        val hoverText = if (enabled) "Click to disable" else "Click to enable"

        val statusComponent = ChatComponentText(statusText).apply {
            chatStyle.color = enabledColor
            chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, toggleCmd)
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText(hoverText).apply { chatStyle.color = if (enabled) ChatColor.RED else ChatColor.GREEN })
        }

        val mainComponent = ChatComponentText("").apply {
            appendSibling(ChatComponentText("BedWars Levelhead ").apply { chatStyle.color = ChatColor.AQUA })
            appendSibling(ChatComponentText("v${Levelhead.VERSION}").apply { chatStyle.color = ChatColor.GOLD })
            appendSibling(ChatComponentText(": ").apply { chatStyle.color = ChatColor.YELLOW })
            appendSibling(statusComponent)
            appendSibling(ChatComponentText(".").apply { chatStyle.color = ChatColor.YELLOW })
        }

        sendMessage(mainComponent)
        sendMessage(
            "${ChatColor.YELLOW}Header: ${ChatColor.GOLD}$header${ChatColor.YELLOW}, " +
                "offset ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", offset)}${ChatColor.YELLOW}, " +
                "show self ${formatToggle(showSelf)}${ChatColor.YELLOW}."
        )
        sendMessage(
            "${ChatColor.YELLOW}Proxy: $proxyState${ChatColor.YELLOW}. " +
                "${ChatColor.GRAY}Try ${ChatColor.GOLD}/levelhead status${ChatColor.GRAY} or ${ChatColor.GOLD}/levelhead display${ChatColor.GRAY} for more controls."
        )
    }

    @SubCommand(aliases = ["setapikey"])
    fun apikey(key: String) {
        if (key.equals("clear", ignoreCase = true)) {
            LevelheadConfig.clearApiKey()
            sendSuccessWithStatusLink("${ChatColor.GREEN}Cleared stored Hypixel API key.")
            resetBedwarsFetcher()
            return
        }

        val sanitized = key.trim()
        val normalized = sanitized.replace("-", "")
        if (!API_KEY_PATTERN.matches(normalized)) {
            val length = normalized.length
            val reason = if (length != 32) {
                "Length is $length (should be 32)"
            } else {
                "Contains invalid characters"
            }

            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Invalid Hypixel API key. $reason.${ChatColor.YELLOW} Try ",
                command = APIKEY_COMMAND,
                suggestedCommand = APIKEY_SUGGESTION,
                suffix = "${ChatColor.YELLOW} with a valid 32-character key."
            )
            sendMessage(msg)
            sendMessage(getDeveloperKeyHelpMessage())
            return
        }

        requireConfirmation("Changing your API key will allow the new key to be used for stat requests.") {
            LevelheadConfig.updateApiKey(sanitized)
            sendSuccessWithStatusLink("${ChatColor.GREEN}Saved Hypixel API key for BedWars stat fetching.")
            resetBedwarsFetcher()

            // Background validation of the API key
            Levelhead.scope.launch {
                val valid = validateApiKey(sanitized)
                if (!valid) {
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Warning: That API key appears to be invalid (Hypixel rejected it).${ChatColor.YELLOW} Try ",
                        command = APIKEY_COMMAND,
                        suggestedCommand = APIKEY_SUGGESTION,
                        suffix = "${ChatColor.YELLOW} to try again."
                    )
                    sendMessage(msg)
                    sendMessage(getDeveloperKeyHelpMessage())
                }
            }
        }
    }

    @SubCommand
    fun clearapikey() {
        requireConfirmation("Clearing your API key will disable stat fetching.") {
            LevelheadConfig.clearApiKey()
            sendSuccessWithStatusLink("${ChatColor.GREEN}Cleared stored Hypixel API key.")
            resetBedwarsFetcher()
        }
    }

    @SubCommand
    fun reload() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        sendSuccessWithStatusLink("${ChatColor.GREEN}Reloaded BedWars star cache.")
    }

    @SubCommand
    fun copy() {
        val minecraft = Minecraft.getMinecraft()
        val target = minecraft.objectMouseOver?.entityHit
        if (target == null || target !is EntityPlayer) {
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}You are not looking at a player.${ChatColor.YELLOW} Look at someone, or try ",
                command = "/levelhead whois <player>",
                run = false,
                suggestedCommand = "/levelhead whois ",
                suffix = "${ChatColor.YELLOW} to lookup stats manually."
            )
            sendMessage(msg)
            return
        }
        val uuid = target.uniqueID.toString()
        GuiScreen.setClipboardString(uuid)
        val msg = ChatComponentText("${ChatColor.GREEN}Copied UUID of ${ChatColor.GOLD}${target.name}${ChatColor.GREEN} to clipboard: ")
            .appendSibling(ChatComponentText("${ChatColor.AQUA}$uuid").apply {
                chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, "/levelhead whois $uuid")
                chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to lookup stats"))
            })
        sendMessage(msg)
    }

    @SubCommand
    fun enable() {
        updateEnabledState(true)
    }

    @SubCommand
    fun disable() {
        updateEnabledState(false)
    }

    @SubCommand
    fun toggle() {
        updateEnabledState(!Levelhead.displayManager.config.enabled)
    }

    @SubCommand(aliases = ["power"])
    fun mod(state: String) {
        val toggle = parseToggle(state)
        if (toggle == null) {
            val sanitizedState = state.replace("§", "")
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Couldn't understand '$sanitizedState'.${ChatColor.YELLOW} Try ",
                command = "/levelhead mod on",
                run = true,
                suffix = "${ChatColor.YELLOW} or "
            )
            msg.appendSibling(CommandUtils.buildInteractiveFeedback(
                messagePrefix = "",
                command = "/levelhead mod off",
                run = true,
                suffix = "${ChatColor.YELLOW}. Current state: ${formatToggle(Levelhead.displayManager.config.enabled)}${ChatColor.YELLOW}."
            ))
            sendMessage(msg)
            return
        }
        updateEnabledState(toggle)
    }

    @SubCommand
    fun gui() {
        val minecraft = Minecraft.getMinecraft()
        minecraft.addScheduledTask {
            LevelheadConfig.openGui()
        }
    }

    @SubCommand
    fun status() {
        val snapshot = Levelhead.statusSnapshot()
        val proxyStatus = when {
            !snapshot.proxyEnabled -> "${ChatColor.GRAY}disabled"
            snapshot.proxyConfigured -> "${ChatColor.GREEN}configured"
            else -> "${ChatColor.RED}missing config"
        }
        val lastAttempt = formatAge(snapshot.lastAttemptAgeMillis)
        val lastSuccess = formatAge(snapshot.lastSuccessAgeMillis)
        val rateReset = formatAge(snapshot.rateLimitResetMillis)
        val serverCooldown = snapshot.serverCooldownMillis?.let { formatAge(it) }

        sendStatus("${ChatColor.GREEN}Status snapshot:")
        sendStatus("${ChatColor.YELLOW}Proxy: $proxyStatus")
        sendStatus("${ChatColor.YELLOW}Cache size: ${ChatColor.GOLD}${snapshot.cacheSize}")
        sendStatus(
            "${ChatColor.YELLOW}Star cache TTL: ${ChatColor.GOLD}${snapshot.starCacheTtlMinutes}m" +
                "${ChatColor.YELLOW} (cold misses: ${ChatColor.GOLD}${snapshot.cacheMissesCold}${ChatColor.YELLOW}," +
                " expired refreshes: ${ChatColor.GOLD}${snapshot.cacheMissesExpired}${ChatColor.YELLOW})"
        )
        sendStatus("${ChatColor.YELLOW}Last request: ${ChatColor.GOLD}$lastAttempt${ChatColor.YELLOW} ago")
        sendStatus("${ChatColor.YELLOW}Last success: ${ChatColor.GOLD}$lastSuccess${ChatColor.YELLOW} ago")
        sendStatus(
            "${ChatColor.YELLOW}Rate limit: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW} remaining, resets in ${ChatColor.GOLD}$rateReset"
        )
        serverCooldown?.let {
            sendStatus("${ChatColor.YELLOW}Server cooldown hint: ${ChatColor.GOLD}$it${ChatColor.YELLOW} remaining")
        }
    }

    @SubCommand
    fun cachettl(minutesInput: String) {
        val sanitized = minutesInput.trim()
        val parsed = sanitized.toIntOrNull()
        if (parsed == null) {
            val current = LevelheadConfig.starCacheTtlMinutes
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Couldn't read '$minutesInput'.${ChatColor.YELLOW} Try ",
                command = "/levelhead cachettl <minutes>",
                suggestedCommand = "/levelhead cachettl ",
                suffix = "${ChatColor.YELLOW}. Choose a number between ${ChatColor.GOLD}${LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES}${ChatColor.YELLOW} and ${ChatColor.GOLD}${LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES}${ChatColor.YELLOW}. Current TTL: ${ChatColor.GOLD}$current${ChatColor.YELLOW}."
            )
            sendMessage(msg)
            return
        }

        val clamped = parsed.coerceIn(LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES, LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES)
        LevelheadConfig.updateStarCacheTtlMinutes(clamped)
        Levelhead.clearCachedStats()
        sendSuccessWithStatusLink("${ChatColor.GREEN}Updated BedWars star cache TTL to ${ChatColor.GOLD}${clamped} minutes${ChatColor.GREEN}.")
    }

    @SubCommand
    fun display(@Greedy args: String = "") {
        val parsedArgs = args.split(" ")
            .mapNotNull { it.takeIf(String::isNotBlank) }

        if (parsedArgs.isEmpty()) {
            sendDisplayOverview()
            sendDisplayUsage()
            return
        }
        when (parsedArgs[0].lowercase(Locale.ROOT)) {
            "header" -> handleDisplayHeader(parsedArgs.drop(1))
            "offset" -> handleDisplayOffset(parsedArgs.drop(1))
            "showself" -> handleDisplayShowSelf(parsedArgs.drop(1))
            else -> {
                sendMessage("${ChatColor.RED}Unknown option '${parsedArgs[0]}'. ${ChatColor.YELLOW}Valid options: header, offset, showself.")
                sendDisplayUsage()
            }
        }
    }

    @SubCommand
    fun proxy(@Greedy args: String = "") {
        val parsedArgs = args.split(" ")
            .mapNotNull { it.takeIf(String::isNotBlank) }

        if (parsedArgs.isEmpty()) {
            val status = when {
                !LevelheadConfig.proxyEnabled -> "${ChatColor.GRAY}disabled"
                LevelheadConfig.proxyBaseUrl.isBlank() || LevelheadConfig.proxyAuthToken.isBlank() -> "${ChatColor.RED}misconfigured"
                else -> "${ChatColor.GREEN}configured"
            }
            sendMessage("${ChatColor.YELLOW}Proxy is currently $status${ChatColor.YELLOW}.")
            sendProxyHelp()
            return
        }

        when (parsedArgs[0].lowercase(Locale.ROOT)) {
            "enable", "on" -> {
                LevelheadConfig.updateProxyEnabled(true)
                sendSuccessWithStatusLink("${ChatColor.GREEN}Enabled proxy usage for BedWars stats.")
                resetBedwarsFetcher()
            }
            "disable", "off" -> {
                LevelheadConfig.updateProxyEnabled(false)
                sendSuccessWithStatusLink("${ChatColor.GREEN}Disabled proxy usage. ${ChatColor.YELLOW}Hypixel API key will be used directly.")
                resetBedwarsFetcher()
            }
            "url" -> {
                val url = parsedArgs.getOrNull(1)?.trim()
                if (url.isNullOrEmpty()) {
                    val current = LevelheadConfig.proxyBaseUrl.ifBlank { "not set" }
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Provide the proxy base URL.${ChatColor.YELLOW} Current URL: ${ChatColor.GOLD}$current${ChatColor.YELLOW}. Try ",
                        command = "/levelhead proxy url <url>",
                        suggestedCommand = "/levelhead proxy url ",
                        suffix = "${ChatColor.YELLOW}."
                    )
                    sendMessage(msg)
                    return
                }
                val parsed = HttpUrl.parse(url)
                if (parsed == null || parsed.scheme() !in setOf("http", "https")) {
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Invalid proxy base URL.${ChatColor.YELLOW} Try ",
                        command = "/levelhead proxy url <url>",
                        suggestedCommand = "/levelhead proxy url ",
                        suffix = "${ChatColor.YELLOW} with an http or https address."
                    )
                    sendMessage(msg)
                    return
                }
                val sanitized = parsed.newBuilder()
                    .query(null)
                    .fragment(null)
                    .build()
                    .toString()
                    .trimEnd('/')

                requireConfirmation("Changing the proxy URL may expose your IP and API key to the new server.") {
                    LevelheadConfig.updateProxyBaseUrl(sanitized)
                    sendSuccessWithStatusLink("${ChatColor.GREEN}Updated proxy base URL to ${ChatColor.GOLD}$sanitized${ChatColor.GREEN}.")
                    resetBedwarsFetcher()
                }
            }
            "token" -> {
                val token = parsedArgs.getOrNull(1)?.trim()
                if (token.isNullOrEmpty()) {
                    val currentState = if (LevelheadConfig.proxyAuthToken.isBlank()) "not set" else "configured"
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Provide the proxy auth token.${ChatColor.YELLOW} Current token: ${ChatColor.GOLD}$currentState${ChatColor.YELLOW}. Use ",
                        command = "/levelhead proxy token <token>",
                        run = false,
                        suggestedCommand = "/levelhead proxy token ",
                        suffix = "${ChatColor.YELLOW}."
                    )
                    sendMessage(msg)
                    return
                }
                requireConfirmation("Changing the proxy token will update your authentication credentials.") {
                    LevelheadConfig.updateProxyAuthToken(token)
                    sendSuccessWithStatusLink("${ChatColor.GREEN}Updated proxy token.")
                    resetBedwarsFetcher()
                }
            }
            else -> {
                sendMessage("${ChatColor.RED}Unknown proxy option '${parsedArgs[0]}'.")
                sendProxyHelp()
            }
        }
    }

    @SubCommand
    fun admin(@Greedy args: String) {
        val parsedArgs = args.split(" ")
            .mapNotNull { it.takeIf(String::isNotBlank) }

        if (parsedArgs.isEmpty()) {
            sendAdminHelp()
            return
        }
        when (parsedArgs[0].lowercase(Locale.ROOT)) {
            "purgecache" -> handleAdminPurgeCache(parsedArgs.drop(1))
            else -> {
                sendMessage("${ChatColor.RED}Unknown admin action '${parsedArgs[0]}'.")
                sendAdminHelp()
            }
        }
    }

    @SubCommand
    fun whois(@Greedy identifier: String) {
        val trimmedIdentifier = identifier.trim()
        if (trimmedIdentifier.isEmpty()) {
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Try ",
                command = "/levelhead whois <player>",
                run = false,
                suggestedCommand = "/levelhead whois ",
                suffix = "${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."
            )
            sendMessage(msg)
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val resultMessage = WhoisService.lookupWhoisComponent(trimmedIdentifier)
                sendMessage(resultMessage)
            } catch (ex: WhoisService.CommandException) {
                sendMessage(ex.component ?: ChatComponentText("${ChatColor.RED}${ex.message}"))
            } catch (throwable: Throwable) {
                if (throwable is CancellationException) throw throwable
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                val errorMsg = CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Unexpected error while fetching stats. Try ",
                    command = "/levelhead status",
                    run = true,
                    suffix = "${ChatColor.RED} to check your connection or check logs for details. If this issue persists, please make an issue on GitHub: https://github.com/beenycool/bedwars-level-head/"
                )
                sendMessage(errorMsg)
            }
        }
    }

    @SubCommand
    fun debug() {
        val gameMode = ModeManager.getActiveGameMode()
        val context = gameMode?.let {
            when (it) {
                GameMode.BEDWARS -> club.sk1er.mods.levelhead.core.BedwarsModeDetector.currentContext()
                GameMode.DUELS -> club.sk1er.mods.levelhead.duels.DuelsModeDetector.currentContext()
                GameMode.SKYWARS -> club.sk1er.mods.levelhead.skywars.SkyWarsModeDetector.currentContext()
            }
        }
        val snapshot = Levelhead.statusSnapshot()
        val displayCache = Levelhead.displayManager.aboveHead.sumOf { it.cache.size }
        val runtimeEnabled = Levelhead.displayManager.config.enabled
        val runtimeShowSelf = Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true
        val runtimePosition = Levelhead.displayManager.config.displayPosition
        val runtimeOffset = Levelhead.displayManager.config.offset
        val uiPosition = MasterConfig.DisplayPosition.entries
            .getOrNull(LevelheadConfig.displayPositionIndex) ?: MasterConfig.DisplayPosition.ABOVE
        sendMessage("${ChatColor.GREEN}Debug info:")
        sendMessage("${ChatColor.YELLOW}Game Mode: ${ChatColor.GOLD}${gameMode?.displayName ?: "none"}")
        sendMessage("${ChatColor.YELLOW}Context: ${ChatColor.GOLD}${context?.name?.lowercase(Locale.ROOT) ?: "unknown"}")
        sendMessage("${ChatColor.YELLOW}Mod enabled: UI ${formatToggle(LevelheadConfig.levelheadEnabled)}${ChatColor.YELLOW}, runtime ${formatToggle(runtimeEnabled)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Show self: UI ${formatToggle(LevelheadConfig.showSelf)}${ChatColor.YELLOW}, runtime ${formatToggle(runtimeShowSelf)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Display position: UI ${ChatColor.GOLD}${uiPosition.name.lowercase(Locale.ROOT)}${ChatColor.YELLOW}, runtime ${ChatColor.GOLD}${runtimePosition.name.lowercase(Locale.ROOT)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Vertical offset: UI ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", LevelheadConfig.verticalOffset.toDouble())}${ChatColor.YELLOW}, runtime ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", runtimeOffset)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Config sync debug logging: ${formatToggle(LevelheadConfig.debugConfigSync)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Request debug logging: ${formatToggle(LevelheadConfig.debugRequests)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Render sampling debug logging: ${formatToggle(LevelheadConfig.debugRenderSampling)}${ChatColor.YELLOW}")
        sendMessage("${ChatColor.YELLOW}Cache size: ${ChatColor.GOLD}${snapshot.cacheSize}${ChatColor.YELLOW}, display cache entries: ${ChatColor.GOLD}$displayCache")
        sendMessage("${ChatColor.YELLOW}Rate limiter remaining: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW}, proxy: ${if (snapshot.proxyEnabled) ChatColor.GREEN else ChatColor.GRAY}${if (snapshot.proxyEnabled) "enabled" else "disabled"}${ChatColor.YELLOW}")
        val debugRenderMsg = CommandUtils.buildInteractiveFeedback(
            messagePrefix = "${ChatColor.GRAY}Toggle: ",
            command = "/levelhead debugrender [on|off]",
            suggestedCommand = "/levelhead debugrender ",
            suffix = "${ChatColor.GRAY} to enable/disable render debug (logs header/footer above nametags to latest.log)"
        )
        sendMessage(debugRenderMsg)
    }

    @SubCommand(aliases = ["debugrender"])
    fun debugRender(onOff: String = "") {
        val arg = onOff.trim().lowercase(Locale.ROOT)
        val newState = when (arg) {
            "on", "1", "true" -> true
            "off", "0", "false" -> false
            else -> !LevelheadConfig.debugRenderSampling
        }
        LevelheadConfig.debugRenderSampling = newState
        sendMessage(
            "${ChatColor.GREEN}Render debug logging: ${formatToggle(newState)}${ChatColor.YELLOW}. " +
                "Check ${ChatColor.GOLD}latest.log${ChatColor.YELLOW} for [LevelheadDebug][render] entries (header/footer per player)."
        )
    }

    @SubCommand
    fun profile(@Greedy args: String = "") {
        val parsedArgs = args.split(" ")
            .mapNotNull { it.takeIf(String::isNotBlank) }

        if (parsedArgs.isEmpty()) {
            sendProfileHelp()
            return
        }

        when (parsedArgs[0].lowercase(Locale.ROOT)) {
            "list" -> {
                sendMessage("${ChatColor.GREEN}Available presets:")
                ConfigProfiles.Preset.entries.forEach { preset ->
val line = ChatComponentText("${ChatColor.YELLOW}- ").appendSibling(
    ChatComponentText("${ChatColor.GOLD}${preset.displayName}").apply {
        chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, "/levelhead profile apply ${preset.name}")
        chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to apply ${preset.displayName}"))
    }
).appendSibling(ChatComponentText("${ChatColor.YELLOW}: ${ChatColor.GRAY}${preset.description}"))
                    sendMessage(line)
                }
            }
            "apply" -> {
                val presetName = parsedArgs.getOrNull(1)?.trim()
                if (presetName.isNullOrEmpty()) {
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Specify a preset name.${ChatColor.YELLOW} Use ",
                        command = "/levelhead profile list",
                        run = true,
                        suffix = "${ChatColor.YELLOW} to see available presets."
                    )
                    sendMessage(msg)
                    return
                }
                val preset = ConfigProfiles.Preset.entries.find { 
                    it.displayName.equals(presetName, ignoreCase = true) || it.name.equals(presetName, ignoreCase = true)
                }
                if (preset == null) {
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Unknown preset '$presetName'.${ChatColor.YELLOW} Use ",
                        command = "/levelhead profile list",
                        run = true,
                        suffix = "${ChatColor.YELLOW} to see available presets."
                    )
                    sendMessage(msg)
                    return
                }
                val profile = ConfigProfiles.getPreset(preset)
                ConfigProfiles.applyProfile(profile)
                sendSuccessWithDisplayLink("${ChatColor.GREEN}Applied ${ChatColor.GOLD}${preset.displayName}${ChatColor.GREEN} profile!")
            }
            "export" -> {
                val exported = ConfigProfiles.exportProfile()
                GuiScreen.setClipboardString(exported)
                sendMessage("${ChatColor.GREEN}Exported current configuration to clipboard. Share it with others!")
            }
            "import" -> {
                val clipboard = GuiScreen.getClipboardString()
                if (clipboard.isNullOrBlank()) {
                    val msg = ChatComponentText("${ChatColor.RED}Clipboard is empty.${ChatColor.YELLOW} Try using ")
                        .appendSibling(CommandUtils.createClickableCommand("/levelhead profile export", run = true))
                        .appendSibling(ChatComponentText("${ChatColor.YELLOW} to create a profile JSON first."))
                    sendMessage(msg)
                    return
                }
                val profile = ConfigProfiles.importProfile(clipboard)
                if (profile == null) {
                    sendMessage("${ChatColor.RED}Invalid profile data in clipboard.${ChatColor.YELLOW} Make sure you copied a valid Levelhead profile.")
                    return
                }
                ConfigProfiles.applyProfile(profile)
                sendSuccessWithDisplayLink("${ChatColor.GREEN}Imported and applied profile ${ChatColor.GOLD}${profile.name}${ChatColor.GREEN}!")
            }
            else -> {
                sendMessage("${ChatColor.RED}Unknown profile action '${parsedArgs[0]}'.")
                sendProfileHelp()
            }
        }
    }

    private fun sendProfileHelp() {
        sendMessage("${ChatColor.YELLOW}Profile commands:")
        fun sendLine(command: String, desc: String, run: Boolean) {
            val suggested = command.substringBefore(" <")
            val line = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "  ",
                command = command,
                run = run,
                suggestedCommand = if (run) command else suggested + " ",
                suffix = " ${ChatColor.GRAY}- $desc"
            )
            sendMessage(line)
        }
        sendLine("/levelhead profile list", "Show available presets", true)
        sendLine("/levelhead profile apply <name>", "Apply a preset", false)
        sendLine("/levelhead profile export", "Export config to clipboard", true)
        sendLine("/levelhead profile import", "Import config from clipboard", true)
    }

    private fun handleDisplayHeader(args: List<String>) {
        if (args.isEmpty()) {
            sendDisplayHeaderDetails()
            return
        }
        when (args[0].lowercase(Locale.ROOT)) {
            "text" -> {
                val text = args.drop(1).joinToString(" ").trim()
                if (text.isEmpty()) {
                    val msg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Header text cannot be empty.${ChatColor.YELLOW} Try ",
                        command = "/levelhead display header text <value>",
                        suggestedCommand = "/levelhead display header text ",
                        suffix = "${ChatColor.YELLOW}. Current header: ${ChatColor.GOLD}${currentHeaderText()}${ChatColor.YELLOW}."
                    )
                    sendMessage(msg)
                    return
                }
                val sanitized = text.take(48)
                val previous = LevelheadConfig.headerText
                if (previous != sanitized) {
                    LevelheadConfig.headerText = sanitized
                    sendSuccessWithDisplayLink("${ChatColor.GREEN}Updated header text to ${ChatColor.GOLD}$sanitized${ChatColor.GREEN}.")
                } else {
                    sendMessage("${ChatColor.YELLOW}Header text is already set to ${ChatColor.GOLD}$sanitized${ChatColor.YELLOW}.")
                }
            }
            "color" -> {
                val colorInput = args.getOrNull(1)?.trim()
                if (colorInput.isNullOrEmpty()) {
                    sendDisplayHeaderColorHelp()
                    return
                }
                val color = parseColor(colorInput)
                if (color == null) {
                    val prefixComponent = ChatComponentText("${ChatColor.RED}Unable to parse color '$colorInput'.${ChatColor.YELLOW} Try a hex code (e.g. ${ChatColor.GOLD}#ff00ff${ChatColor.YELLOW}), RGB (r,g,b), or a ")
                    prefixComponent.appendSibling(getMinecraftColorNameHelpComponent())
                    prefixComponent.appendSibling(ChatComponentText("${ChatColor.YELLOW}. Use "))
                    val combinedMsg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "",
                        command = "/levelhead display header color <color>",
                        suggestedCommand = "/levelhead display header color ",
                        suffix = "${ChatColor.YELLOW}. Current header color: ${ChatColor.GOLD}${formatColor(currentHeaderColor())}${ChatColor.YELLOW}."
                    )
                    val finalMsg = prefixComponent.appendSibling(combinedMsg)
                    sendMessage(finalMsg)
                    return
                }
                val hexColor = formatColor(color)
                val previous = LevelheadConfig.headerColorHex
                if (previous != hexColor) {
                    LevelheadConfig.headerColorHex = hexColor
                    sendSuccessWithDisplayLink("${ChatColor.GREEN}Updated header color to ${ChatColor.GOLD}$hexColor${ChatColor.GREEN}.")
                } else {
                    sendMessage("${ChatColor.YELLOW}Header color is already $hexColor${ChatColor.YELLOW}.")
                }
            }
            else -> {
                sendMessage(
                    "${ChatColor.RED}Unknown option '${args[0]}'. ${ChatColor.YELLOW}Valid options: text, color."
                )
                sendDisplayHeaderDetails()
            }
        }
    }


    private fun handleDisplayOffset(args: List<String>) {
        val valueRaw = args.getOrNull(0)?.trim()
        val parsed = valueRaw?.toDoubleOrNull()
        if (parsed == null) {
            sendDisplayOffsetDetails()
            return
        }
        val clamped = parsed.coerceIn(MIN_DISPLAY_OFFSET, MAX_DISPLAY_OFFSET)
        val previous = LevelheadConfig.verticalOffset
        if (abs(previous - clamped) < 0.0001) {
            sendMessage("${ChatColor.YELLOW}Offset already set to ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", clamped)}${ChatColor.YELLOW}.")
        } else {
            LevelheadConfig.verticalOffset = clamped.toFloat()
            sendSuccessWithDisplayLink("${ChatColor.GREEN}Updated display offset to ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", clamped)}${ChatColor.GREEN}.")
        }
    }


    private fun handleDisplayShowSelf(args: List<String>) {
        if (args.isEmpty()) {
            sendDisplayShowSelfDetails()
            return
        }
        val toggle = args.getOrNull(0)?.let { parseToggle(it) }
        if (toggle == null) {
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Couldn't understand '${args[0]}'.${ChatColor.YELLOW} Use ",
                command = "/levelhead display showself <on|off>",
                suggestedCommand = "/levelhead display showself ",
                suffix = "${ChatColor.YELLOW}. Current setting: ${formatToggle(currentShowSelf())}${ChatColor.YELLOW}."
            )
            sendMessage(msg)
            return
        }
        val previous = LevelheadConfig.showSelf
        if (previous != toggle) {
            LevelheadConfig.showSelf = toggle
            sendSuccessWithDisplayLink("${ChatColor.GREEN}Self display is now ${formatToggle(toggle)}${ChatColor.GREEN}.")
        } else {
            sendMessage("${ChatColor.YELLOW}Self display is already ${formatToggle(toggle)}${ChatColor.YELLOW}.")
        }
    }


    private fun handleAdminPurgeCache(args: List<String>) {
        if (!isProxyFullyConfigured()) {
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Proxy must be enabled and configured to purge the backend cache.${ChatColor.YELLOW} Try ",
                command = "/levelhead proxy",
                run = true,
                suffix = "${ChatColor.YELLOW} to configure it."
            )
            sendMessage(msg)
            return
        }
        val identifier = args.joinToString(" ").trim()
            .takeIf { it.isNotEmpty() }
            ?.let { raw ->
                val collapsed = raw.replace("-", "")
                if (PlayerIdentifiers.UUID_NO_DASH_PATTERN.matches(collapsed)) collapsed.lowercase(Locale.ROOT) else raw
            }

        Levelhead.scope.launch {
            try {
                val purged = purgeProxyCache(identifier)
                Minecraft.getMinecraft().addScheduledTask {
                    val scopeText = identifier?.let { "for ${ChatColor.GOLD}$it${ChatColor.YELLOW}" } ?: "globally"
                    sendSuccessWithStatusLink("${ChatColor.GREEN}Requested cache purge $scopeText (${ChatColor.GOLD}$purged${ChatColor.GREEN} entries).")
                }
            } catch (ex: CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}${ex.message}")
                }
            } catch (throwable: Throwable) {
                if (throwable is CancellationException) throw throwable
                Levelhead.logger.error("Failed to purge proxy cache", throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    val errorMsg = CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}Unexpected error while purging cache. Try ",
                        command = "/levelhead status",
                        run = true,
                        suffix = "${ChatColor.RED} to check your connection or check logs for details. If this issue persists, please make an issue on GitHub: https://github.com/beenycool/bedwars-level-head/"
                    )
                    sendMessage(errorMsg)
                }
            }
        }
    }

    private fun resetBedwarsFetcher() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCachesWithoutRefetch()
        BedwarsFetcher.resetWarnings()
    }

    private fun sendProxyHelp() {
        val baseUrl = LevelheadConfig.proxyBaseUrl.ifBlank { "not set" }
        val tokenState = if (LevelheadConfig.proxyAuthToken.isBlank()) "not set" else "configured"
        val enabledState = formatToggle(LevelheadConfig.proxyEnabled)
        sendMessage(
            "${ChatColor.GRAY}Options:${ChatColor.YELLOW} enable/disable toggle usage (${enabledState}${ChatColor.YELLOW}), url to set the backend (${ChatColor.GOLD}$baseUrl${ChatColor.YELLOW}), token to update auth (${ChatColor.GOLD}$tokenState${ChatColor.YELLOW})."
        )
        val toggleCmd = if (LevelheadConfig.proxyEnabled) "/levelhead proxy disable" else "/levelhead proxy enable"
        val msg = CommandUtils.buildInteractiveFeedback(
            messagePrefix = "${ChatColor.GRAY}Try: ",
            command = toggleCmd,
            run = true,
            suffix = "${ChatColor.YELLOW}, "
        )
        msg.appendSibling(CommandUtils.buildInteractiveFeedback(
            messagePrefix = "",
            command = "/levelhead proxy url <url>",
            suggestedCommand = "/levelhead proxy url ",
            run = false,
            suffix = "${ChatColor.YELLOW}, "
        ))
        msg.appendSibling(CommandUtils.buildInteractiveFeedback(
            messagePrefix = "",
            command = "/levelhead proxy token <token>",
            suggestedCommand = "/levelhead proxy token ",
            run = false,
            suffix = "${ChatColor.YELLOW}."
        ))
        sendMessage(msg)
    }

    private fun sendAdminHelp() {
        sendMessage(
            "${ChatColor.YELLOW}Admin commands control the proxy cache.${ChatColor.GRAY} Available: ${ChatColor.GOLD}purgecache [player]${ChatColor.GRAY} to clear cached stats globally or for a specific player."
        )
        val msg = CommandUtils.buildInteractiveFeedback(
            messagePrefix = "${ChatColor.GRAY}Example: ",
            command = "/levelhead admin purgecache",
            run = false,
            suffix = "${ChatColor.YELLOW} (all) or "
        )
        msg.appendSibling(CommandUtils.buildInteractiveFeedback(
            messagePrefix = "",
            command = "/levelhead admin purgecache Notch",
            run = false,
            suffix = "${ChatColor.YELLOW}."
        ))
        sendMessage(msg)
    }

    private fun sendStatus(message: String) {
        sendMessage(message)
    }

    private fun updateEnabledState(enabled: Boolean) {
        val changed = Levelhead.displayManager.config.enabled != enabled
        LevelheadConfig.levelheadEnabled = enabled
        val stateText = if (enabled) "enabled" else "disabled"
        val color = if (enabled) ChatColor.GREEN else ChatColor.RED
        val message = if (changed) {
            "${color}BedWars Levelhead ${ChatColor.YELLOW}has been ${color}$stateText${ChatColor.YELLOW}."
        } else {
            "${ChatColor.YELLOW}BedWars Levelhead is already ${color}$stateText${ChatColor.YELLOW}."
        }
        if (changed) {
            sendSuccessWithDisplayLink(message)
        } else {
            sendMessage(message)
        }
    }

    private fun formatAge(ageMillis: Long?): String {
        ageMillis ?: return "never"
        val totalSeconds = (ageMillis / 1000).coerceAtLeast(0)
        val seconds = (totalSeconds % 60).toInt()
        val minutesTotal = totalSeconds / 60
        val minutes = (minutesTotal % 60).toInt()
        val hours = (minutesTotal / 60).toInt()
        return when {
            hours > 0 -> String.format(Locale.ROOT, "%dh %dm", hours, minutes)
            minutes > 0 -> String.format(Locale.ROOT, "%dm %ds", minutes, seconds)
            else -> String.format(Locale.ROOT, "%ds", seconds)
        }
    }

    private fun sendSuccessWithStatusLink(message: String) {
        sendSuccessWithLink(message, " ${ChatColor.GRAY}[Check Status]", "/levelhead status", "${ChatColor.GREEN}Click to check status")
    }

    private fun sendSuccessWithDisplayLink(message: String) {
        sendSuccessWithLink(message, " ${ChatColor.GRAY}[Check Display]", "/levelhead display", "${ChatColor.GREEN}Click to view display settings")
    }

    private fun sendSuccessWithLink(message: String, linkText: String, linkCommand: String, linkHover: String) {
        val msg = ChatComponentText(message).appendSibling(
            ChatComponentText(linkText).apply {
                chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, linkCommand)
                chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText(linkHover))
            }
        )
        sendMessage(msg)
    }

    private fun sendMessage(message: String) {
        CommandUtils.sendPrefixedChat(ChatComponentText(message))
    }

    private fun sendMessage(component: IChatComponent) {
        CommandUtils.sendPrefixedChat(component)
    }

    private fun sendDisplayOverview() {
        val primaryDisplay = Levelhead.displayManager.primaryDisplay()
        val headerText = primaryDisplay?.config?.headerString ?: GameMode.BEDWARS.defaultHeader
        val headerColor = primaryDisplay?.config?.headerColor ?: Color(85, 255, 255)
        val showSelf = primaryDisplay?.config?.showSelf ?: true
        val offset = Levelhead.displayManager.config.offset

        sendMessage(
            "${ChatColor.YELLOW}Primary header: ${ChatColor.GOLD}$headerText${ChatColor.YELLOW} (${ChatColor.GOLD}${formatColor(headerColor)}${ChatColor.YELLOW})."
        )
        sendMessage(
            "${ChatColor.YELLOW}Display offset: ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", offset)}${ChatColor.YELLOW}, show self ${formatToggle(showSelf)}${ChatColor.YELLOW}."
        )
    }

private fun sendDisplayUsage() {
    val msg = CommandUtils.buildInteractiveFeedback(
        messagePrefix = "${ChatColor.GRAY}Use ",
        command = "/levelhead display header <text|color>",
        suggestedCommand = "/levelhead display header ",
        run = false,
        suffix = "${ChatColor.GRAY}, "
    )
    msg.appendSibling(CommandUtils.buildInteractiveFeedback(
        messagePrefix = "",
        command = "/levelhead display offset <value>",
        suggestedCommand = "/levelhead display offset ",
        run = false,
        suffix = "${ChatColor.GRAY}, "
    ))
    msg.appendSibling(CommandUtils.buildInteractiveFeedback(
        messagePrefix = "",
        command = "/levelhead display showself <on|off>",
        suggestedCommand = "/levelhead display showself ",
        run = false,
        suffix = "${ChatColor.GRAY} to make changes."
    ))
        sendMessage(msg)
    }

private fun sendDisplayHeaderDetails() {
    val msg = CommandUtils.buildInteractiveFeedback(
        messagePrefix = "${ChatColor.YELLOW}Current header text: ${ChatColor.GOLD}${currentHeaderText()}${ChatColor.YELLOW}. Use ",
        command = "/levelhead display header text <value>",
        suggestedCommand = "/levelhead display header text ",
        run = false,
        suffix = "${ChatColor.YELLOW} to change it."
    )
        sendMessage(msg)
        sendDisplayHeaderColorHelp()
    }

private fun sendDisplayHeaderColorHelp() {
    val msg = CommandUtils.buildInteractiveFeedback(
        messagePrefix = "${ChatColor.YELLOW}Current header color: ${ChatColor.GOLD}${formatColor(currentHeaderColor())}${ChatColor.YELLOW}. Use ",
        command = "/levelhead display header color <color>",
        suggestedCommand = "/levelhead display header color ",
        run = false,
        suffix = "${ChatColor.YELLOW} with a hex code, RGB value, or "
    )
            .appendSibling(getMinecraftColorNameHelpComponent())
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
        sendMessage(msg)
    }

private fun sendDisplayOffsetDetails() {
    val offset = Levelhead.displayManager.config.offset
    val msg = CommandUtils.buildInteractiveFeedback(
        messagePrefix = "${ChatColor.YELLOW}Current display offset: ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", offset)}${ChatColor.YELLOW}. Use ",
        command = "/levelhead display offset <value>",
        suggestedCommand = "/levelhead display offset ",
        run = false,
        suffix = "${ChatColor.YELLOW} with a value between "
    )
            .appendSibling(ChatComponentText(String.format(Locale.ROOT, "%.1f", MIN_DISPLAY_OFFSET)).apply { chatStyle.color = ChatColor.GOLD })
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} and "))
            .appendSibling(ChatComponentText(String.format(Locale.ROOT, "%.1f", MAX_DISPLAY_OFFSET)).apply { chatStyle.color = ChatColor.GOLD })
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
        sendMessage(msg)
    }

private fun sendDisplayShowSelfDetails() {
    val msg = CommandUtils.buildInteractiveFeedback(
        messagePrefix = "${ChatColor.YELLOW}Self display visibility is currently ${formatToggle(currentShowSelf())}${ChatColor.YELLOW}. Use ",
        command = "/levelhead display showself <on|off>",
        suggestedCommand = "/levelhead display showself ",
        run = false,
        suffix = "${ChatColor.YELLOW}."
    )
    sendMessage(msg)
    }

    private fun getMinecraftColorNameHelpComponent(): IChatComponent {
        val hoverContent = ChatComponentText("${ChatColor.GREEN}Available colors:")
        NAMED_COLORS.keys.forEach { name ->
            val colorCode = runCatching { ChatColor.valueOf(name.uppercase(Locale.ROOT)) }.getOrNull() ?: ChatColor.GRAY
            hoverContent.appendSibling(ChatComponentText("\n - ").apply { chatStyle.color = ChatColor.GRAY })
            hoverContent.appendSibling(ChatComponentText(name).apply { chatStyle.color = colorCode })
        }

        return ChatComponentText("Minecraft color name").apply {
            chatStyle.color = ChatColor.GOLD
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, hoverContent)
        }
    }



    private fun currentHeaderText(): String {
        return Levelhead.displayManager.primaryDisplay()?.config?.headerString ?: GameMode.BEDWARS.defaultHeader
    }

    private fun currentHeaderColor(): Color {
        return Levelhead.displayManager.primaryDisplay()?.config?.headerColor ?: Color(85, 255, 255)
    }

    private fun currentShowSelf(): Boolean {
        return Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true
    }

    private fun formatToggle(value: Boolean): String {
        return if (value) "${ChatColor.GREEN}on" else "${ChatColor.RED}off"
    }

    private fun parseToggle(value: String): Boolean? {
        return when (value.lowercase(Locale.ROOT)) {
            "on", "1", "true", "enable" -> true
            "off", "0", "false", "disable" -> false
            else -> null
        }
    }

    private fun parseColor(input: String): Color? {
        val lower = input.lowercase(Locale.ROOT)
        if (NAMED_COLORS.containsKey(lower)) {
            return NAMED_COLORS[lower]
        }
        if (HEX_COLOR_PATTERN.matches(input)) {
            val hex = if (input.startsWith("#")) input else "#$input"
            return runCatching { Color.decode(hex) }.getOrNull()
        }
        val rgbMatch = RGB_COLOR_PATTERN.matchEntire(input)
        if (rgbMatch != null) {
            val r = rgbMatch.groupValues[1].toIntOrNull() ?: return null
            val g = rgbMatch.groupValues[2].toIntOrNull() ?: return null
            val b = rgbMatch.groupValues[3].toIntOrNull() ?: return null
            if (r in 0..255 && g in 0..255 && b in 0..255) {
                return Color(r, g, b)
            }
        }
        return null
    }

    private fun formatColor(color: Color): String = "#%06X".format(Locale.ROOT, color.rgb and 0xFFFFFF)

    private fun isProxyFullyConfigured(): Boolean {
        return LevelheadConfig.proxyEnabled &&
            LevelheadConfig.proxyBaseUrl.isNotBlank() &&
            LevelheadConfig.proxyAuthToken.isNotBlank()
    }

    private fun getDeveloperKeyHelpMessage(): IChatComponent {
        val hoverContent = ChatComponentText("${ChatColor.GREEN}Hypixel no longer gives out personal developer APIs.\n")
            .appendSibling(ChatComponentText("${ChatColor.GRAY}You must configure a proxy using ${ChatColor.GOLD}/levelhead proxy${ChatColor.GRAY} to continue viewing stats."))

        return ChatComponentText("${ChatColor.YELLOW}Don't have a key? ")
            .appendSibling(ChatComponentText("${ChatColor.AQUA}[Learn More]").apply {
                chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, "/levelhead proxy")
                chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, hoverContent)
            })
    }

    private suspend fun purgeProxyCache(identifier: String?): Int {
        val baseUrl = LevelheadConfig.proxyBaseUrl.trimEnd('/')
        val urlBuilder = HttpUrl.parse("$baseUrl/api/admin/cache")?.newBuilder()
            ?: throw CommandException("Invalid proxy URL configured.")

        if (identifier != null) {
            urlBuilder.addQueryParameter("player", identifier)
        }

        val request = Request.Builder()
            .url(urlBuilder.build())
            .delete()
            .header("Authorization", "Bearer ${LevelheadConfig.proxyAuthToken}")
            .build()

        return withContext(Dispatchers.IO) {
            Levelhead.okHttpClient.newCall(request).await().use { response ->
                if (!response.isSuccessful) {
                    val errorBody = response.body()?.string()
                    val errorMessage = try {
                        errorBody?.let { JsonParser.parseString(it).asJsonObject.get("error")?.asString }
                    } catch (e: Exception) { null } ?: "HTTP ${response.code()}"

                    throw CommandException("Purge failed: $errorMessage")
                }

                val bodyStr = response.body()?.string() ?: "{}"
                val json = JsonParser.parseString(bodyStr).asJsonObject
                json.get("purged")?.asInt ?: 0
            }
        }
    }

    private suspend fun validateApiKey(key: String): Boolean {
        val request = Request.Builder()
            .url("https://api.hypixel.net/key")
            .header("API-Key", key)
            .get()
            .build()

        return withContext(Dispatchers.IO) {
            try {
                Levelhead.okHttpClient.newCall(request).await().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body()?.string() ?: return@use false
                        val json = JsonParser.parseString(body).asJsonObject
                        json.get("success")?.asBoolean == true
                    } else {
                        false
                    }
                }
            } catch (e: Exception) {
                Levelhead.logger.error("Failed to validate API key", e)
                false
            }
        }
    }
}

private var pendingAction: (() -> Unit)? = null
private var pendingActionTimestamp: Long = 0L
private const val CONFIRMATION_TIMEOUT_MS = 30_000L // 30 seconds

private fun requireConfirmation(warningMessage: String, action: () -> Unit) {
    if (pendingAction != null && System.currentTimeMillis() - pendingActionTimestamp < CONFIRMATION_TIMEOUT_MS) {
        CommandUtils.sendPrefixedChat(ChatComponentText("§cAn action is already pending. Please §a/levelhead confirm§c or wait for it to expire."))
        return
    }

    val msg = ChatComponentText("${ChatColor.RED}Warning: ${ChatColor.YELLOW}$warningMessage Are you sure? ")
        .appendSibling(ChatComponentText("${ChatColor.GREEN}[Confirm]").apply {
            chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, "/levelhead confirm")
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to confirm"))
        })
    CommandUtils.sendPrefixedChat(msg)

    pendingAction = action
    pendingActionTimestamp = System.currentTimeMillis()
}
