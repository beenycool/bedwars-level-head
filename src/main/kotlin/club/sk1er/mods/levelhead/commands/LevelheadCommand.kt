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
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.awt.Color
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.text.RegexOption

@Command(value = "levelhead", aliases = ["lh"])
class LevelheadCommand {

    companion object {
        private val API_KEY_PATTERN = Regex("^[a-f0-9]{32}$", RegexOption.IGNORE_CASE)
        private val HEX_COLOR_PATTERN = Regex("^#?[0-9a-fA-F]{6}$")
        private val RGB_COLOR_PATTERN = Regex("^(\\d{1,3}),(\\d{1,3}),(\\d{1,3})$")
        private const val MIN_DISPLAY_OFFSET = -1.5
        private const val MAX_DISPLAY_OFFSET = 3.0
        private val JSON_MEDIA_TYPE: MediaType = MediaType.parse("application/json; charset=utf-8")
            ?: error("Failed to initialise JSON media type")
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
            sendMessage("${ChatColor.GREEN}Cleared stored Hypixel API key.")
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

            sendMessage("${ChatColor.RED}Invalid Hypixel API key. $reason.")
            sendMessage(getDeveloperKeyHelpMessage())
            return
        }

        LevelheadConfig.updateApiKey(sanitized)
        sendMessage("${ChatColor.GREEN}Saved Hypixel API key for BedWars stat fetching.")
        resetBedwarsFetcher()

        // Background validation of the API key
        Levelhead.scope.launch {
            val valid = validateApiKey(sanitized)
            if (!valid) {
                sendMessage("${ChatColor.RED}Warning: That API key appears to be invalid (Hypixel rejected it).")
                sendMessage(getDeveloperKeyHelpMessage())
            }
        }
    }

    @SubCommand
    fun clearapikey() {
        LevelheadConfig.clearApiKey()
        sendMessage("${ChatColor.GREEN}Cleared stored Hypixel API key.")
        resetBedwarsFetcher()
    }

    @SubCommand
    fun reload() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        sendMessage("${ChatColor.GREEN}Reloaded BedWars star cache.")
    }

    @SubCommand
    fun copy() {
        val minecraft = Minecraft.getMinecraft()
        val target = minecraft.objectMouseOver?.entityHit
        if (target == null || target !is EntityPlayer) {
            sendMessage("${ChatColor.RED}You are not looking at a player.")
            return
        }
        val uuid = target.uniqueID.toString()
        GuiScreen.setClipboardString(uuid)
        sendMessage("${ChatColor.GREEN}Copied UUID of ${ChatColor.GOLD}${target.name}${ChatColor.GREEN} to clipboard: ${ChatColor.AQUA}$uuid")
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
            val msg = ChatComponentText("${ChatColor.RED}Couldn't understand '$sanitizedState'.${ChatColor.YELLOW} Try ")
                .appendSibling(createClickableCommand("/levelhead mod on", run = true))
                .appendSibling(ChatComponentText("${ChatColor.YELLOW} or "))
                .appendSibling(createClickableCommand("/levelhead mod off", run = true))
                .appendSibling(ChatComponentText("${ChatColor.YELLOW}. Current state: ${formatToggle(Levelhead.displayManager.config.enabled)}${ChatColor.YELLOW}."))
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
            sendMessage(
                "${ChatColor.RED}Couldn't read '$minutesInput'.${ChatColor.YELLOW} Choose a number of minutes between ${ChatColor.GOLD}${LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES}${ChatColor.YELLOW} and ${ChatColor.GOLD}${LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES}${ChatColor.YELLOW}. Current TTL: ${ChatColor.GOLD}$current${ChatColor.YELLOW}."
            )
            return
        }

        val clamped = parsed.coerceIn(LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES, LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES)
        LevelheadConfig.updateStarCacheTtlMinutes(clamped)
        Levelhead.clearCachedStats()
        sendMessage("${ChatColor.GREEN}Updated BedWars star cache TTL to ${ChatColor.GOLD}${clamped} minutes${ChatColor.GREEN}.")
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
                sendMessage("${ChatColor.GREEN}Enabled proxy usage for BedWars stats.")
                resetBedwarsFetcher()
            }
            "disable", "off" -> {
                LevelheadConfig.updateProxyEnabled(false)
                sendMessage("${ChatColor.YELLOW}Disabled proxy usage. Hypixel API key will be used directly.")
                resetBedwarsFetcher()
            }
            "url" -> {
                val url = parsedArgs.getOrNull(1)?.trim()
                if (url.isNullOrEmpty()) {
                    val current = LevelheadConfig.proxyBaseUrl.ifBlank { "not set" }
                    val msg = ChatComponentText("${ChatColor.RED}Provide the proxy base URL.${ChatColor.YELLOW} Current URL: ${ChatColor.GOLD}$current${ChatColor.YELLOW}. Try ")
                        .appendSibling(
                            ChatComponentText("${ChatColor.GOLD}/levelhead proxy url <url>").apply {
                                chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.SUGGEST_COMMAND, "/levelhead proxy url ")
                                chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to fill"))
                            }
                        )
                        .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
                    sendMessage(msg)
                    return
                }
                val parsed = HttpUrl.parse(url)
                if (parsed == null || parsed.scheme() !in setOf("http", "https")) {
                    sendMessage(
                        "${ChatColor.RED}Invalid proxy base URL.${ChatColor.YELLOW} Use an http or https address like ${ChatColor.GOLD}https://example.com${ChatColor.YELLOW}."
                    )
                    return
                }
                val sanitized = parsed.newBuilder()
                    .query(null)
                    .fragment(null)
                    .build()
                    .toString()
                    .trimEnd('/')
                LevelheadConfig.updateProxyBaseUrl(sanitized)
                sendMessage("${ChatColor.GREEN}Updated proxy base URL to ${ChatColor.GOLD}$sanitized${ChatColor.GREEN}.")
                resetBedwarsFetcher()
            }
            "token" -> {
                val token = parsedArgs.getOrNull(1)?.trim()
                if (token.isNullOrEmpty()) {
                    val currentState = if (LevelheadConfig.proxyAuthToken.isBlank()) "not set" else "configured"
                    val msg = ChatComponentText("${ChatColor.RED}Provide the proxy auth token.${ChatColor.YELLOW} Current token: ${ChatColor.GOLD}$currentState${ChatColor.YELLOW}. Use ")
                        .appendSibling(createClickableCommand("/levelhead proxy token "))
                        .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
                    sendMessage(msg)
                    return
                }
                LevelheadConfig.updateProxyAuthToken(token)
                sendMessage("${ChatColor.GREEN}Updated proxy token.")
                resetBedwarsFetcher()
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
            val msg = ChatComponentText("${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Try ")
                .appendSibling(createClickableCommand("/levelhead whois "))
                .appendSibling(ChatComponentText("${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."))
            sendMessage(msg)
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val resultMessage = WhoisService.lookupWhoisMessage(trimmedIdentifier)
                sendMessage(resultMessage)
            } catch (ex: WhoisService.CommandException) {
                sendMessage("${ChatColor.RED}${ex.message}")
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                sendMessage("${ChatColor.RED}Unexpected error while fetching stats. Check logs for details.")
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
        sendMessage("${ChatColor.GRAY}Toggle: ${ChatColor.GOLD}/levelhead debugrender [on|off]${ChatColor.GRAY} to enable/disable render debug (logs header/footer above nametags to latest.log)")
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
                    sendMessage("${ChatColor.RED}Specify a preset name.${ChatColor.YELLOW} Use ${ChatColor.GOLD}/levelhead profile list${ChatColor.YELLOW} to see available presets.")
                    return
                }
                val preset = ConfigProfiles.Preset.entries.find { 
                    it.displayName.equals(presetName, ignoreCase = true) || it.name.equals(presetName, ignoreCase = true)
                }
                if (preset == null) {
                    sendMessage("${ChatColor.RED}Unknown preset '$presetName'.${ChatColor.YELLOW} Use ${ChatColor.GOLD}/levelhead profile list${ChatColor.YELLOW} to see available presets.")
                    return
                }
                val profile = ConfigProfiles.getPreset(preset)
                ConfigProfiles.applyProfile(profile)
                sendMessage("${ChatColor.GREEN}Applied ${ChatColor.GOLD}${preset.displayName}${ChatColor.GREEN} profile!")
            }
            "export" -> {
                val exported = ConfigProfiles.exportProfile()
                GuiScreen.setClipboardString(exported)
                sendMessage("${ChatColor.GREEN}Exported current configuration to clipboard. Share it with others!")
            }
            "import" -> {
                val clipboard = GuiScreen.getClipboardString()
                if (clipboard.isNullOrBlank()) {
                    sendMessage("${ChatColor.RED}Clipboard is empty.${ChatColor.YELLOW} Copy a profile JSON to your clipboard first.")
                    return
                }
                val profile = ConfigProfiles.importProfile(clipboard)
                if (profile == null) {
                    sendMessage("${ChatColor.RED}Invalid profile data in clipboard.${ChatColor.YELLOW} Make sure you copied a valid Levelhead profile.")
                    return
                }
                ConfigProfiles.applyProfile(profile)
                sendMessage("${ChatColor.GREEN}Imported and applied profile ${ChatColor.GOLD}${profile.name}${ChatColor.GREEN}!")
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
            val line = ChatComponentText("  ")
                .appendSibling(createClickableCommand(command, run))
                .appendSibling(ChatComponentText(" ${ChatColor.GRAY}- $desc"))
            sendMessage(line)
        }
        sendLine("/levelhead profile list", "Show available presets", true)
        sendLine("/levelhead profile apply <name>", "Apply a preset", false)
        sendLine("/levelhead profile export", "Export config to clipboard", true)
        sendLine("/levelhead profile import", "Import config from clipboard", false)
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
                    sendMessage("${ChatColor.RED}Header text cannot be empty.${ChatColor.YELLOW} Current header: ${ChatColor.GOLD}${currentHeaderText()}${ChatColor.YELLOW}.")
                    return
                }
                val sanitized = text.take(48)
                val previous = LevelheadConfig.headerText
                if (previous != sanitized) {
                    LevelheadConfig.headerText = sanitized
                    sendMessage("${ChatColor.GREEN}Updated header text to ${ChatColor.GOLD}$sanitized${ChatColor.GREEN}.")
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
                    val msg = ChatComponentText("${ChatColor.RED}Unable to parse color '$colorInput'.${ChatColor.YELLOW} Try a hex code (e.g. ${ChatColor.GOLD}#ff00ff${ChatColor.YELLOW}), RGB (r,g,b), or a ")
                        .appendSibling(getMinecraftColorNameHelpComponent())
                        .appendSibling(ChatComponentText("${ChatColor.YELLOW}. Current header color: ${ChatColor.GOLD}${formatColor(currentHeaderColor())}${ChatColor.YELLOW}."))
                    sendMessage(msg)
                    return
                }
                val hexColor = formatColor(color)
                val previous = LevelheadConfig.headerColorHex
                if (previous != hexColor) {
                    LevelheadConfig.headerColorHex = hexColor
                    sendMessage("${ChatColor.GREEN}Updated header color to ${ChatColor.GOLD}$hexColor${ChatColor.GREEN}.")
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
            sendMessage("${ChatColor.GREEN}Updated display offset to ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", clamped)}${ChatColor.GREEN}.")
        }
    }


    private fun handleDisplayShowSelf(args: List<String>) {
        if (args.isEmpty()) {
            sendDisplayShowSelfDetails()
            return
        }
        val toggle = args.getOrNull(0)?.let { parseToggle(it) }
        if (toggle == null) {
            val msg = ChatComponentText("${ChatColor.RED}Couldn't understand '${args[0]}'.${ChatColor.YELLOW} Use ")
                .appendSibling(createClickableCommand("/levelhead display showself <on|off>"))
                .appendSibling(ChatComponentText("${ChatColor.YELLOW}. Current setting: ${formatToggle(currentShowSelf())}${ChatColor.YELLOW}."))
            sendMessage(msg)
            return
        }
        val previous = LevelheadConfig.showSelf
        if (previous != toggle) {
            LevelheadConfig.showSelf = toggle
            sendMessage("${ChatColor.GREEN}Self display is now ${formatToggle(toggle)}${ChatColor.GREEN}.")
        } else {
            sendMessage("${ChatColor.YELLOW}Self display is already ${formatToggle(toggle)}${ChatColor.YELLOW}.")
        }
    }


    private fun handleAdminPurgeCache(args: List<String>) {
        if (!isProxyFullyConfigured()) {
            sendMessage("${ChatColor.RED}Proxy must be enabled and configured to purge the backend cache.")
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
                    sendMessage("${ChatColor.GREEN}Requested cache purge $scopeText (${ChatColor.GOLD}$purged${ChatColor.GREEN} entries).")
                }
            } catch (ex: CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}${ex.message}")
                }
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to purge proxy cache", throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}Unexpected error while purging cache. Check logs for details.")
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
        val msg = ChatComponentText("${ChatColor.GRAY}Try: ")
            .appendSibling(createClickableCommand(toggleCmd, run = true))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}, "))
            .appendSibling(createClickableCommand("/levelhead proxy url https://example.com"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}, "))
            .appendSibling(createClickableCommand("/levelhead proxy token <token>"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
        sendMessage(msg)
    }

    private fun sendAdminHelp() {
        sendMessage(
            "${ChatColor.YELLOW}Admin commands control the proxy cache.${ChatColor.GRAY} Available: ${ChatColor.GOLD}purgecache [player]${ChatColor.GRAY} to clear cached stats globally or for a specific player."
        )
        val msg = ChatComponentText("${ChatColor.GRAY}Example: ")
            .appendSibling(createClickableCommand("/levelhead admin purgecache", run = false))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} (all) or "))
            .appendSibling(createClickableCommand("/levelhead admin purgecache Notch"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
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
        sendMessage(message)
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

    private fun createClickableCommand(command: String, run: Boolean = false): IChatComponent {
        val action = if (run) ClickEvent.Action.RUN_COMMAND else ClickEvent.Action.SUGGEST_COMMAND
        val hoverText = if (run) "${ChatColor.GREEN}Click to run" else "${ChatColor.GREEN}Click to fill"

        return ChatComponentText("${ChatColor.GOLD}$command").apply {
            chatStyle.chatClickEvent = ClickEvent(action, command)
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText(hoverText))
        }
    }

    private fun sendMessage(message: String) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
        }
    }

    private fun sendMessage(component: IChatComponent) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = ChatComponentText("${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}")
        formatted.appendSibling(component)
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(formatted)
        }
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
        val msg = ChatComponentText("${ChatColor.GRAY}Use ")
            .appendSibling(createClickableCommand("/levelhead display header <text|color>"))
            .appendSibling(ChatComponentText("${ChatColor.GRAY}, "))
            .appendSibling(createClickableCommand("/levelhead display offset <value>"))
            .appendSibling(ChatComponentText("${ChatColor.GRAY}, "))
            .appendSibling(createClickableCommand("/levelhead display showself <on|off>"))
            .appendSibling(ChatComponentText("${ChatColor.GRAY} to make changes."))
        sendMessage(msg)
    }

    private fun sendDisplayHeaderDetails() {
        val msg = ChatComponentText("${ChatColor.YELLOW}Current header text: ${ChatColor.GOLD}${currentHeaderText()}${ChatColor.YELLOW}. Use ")
            .appendSibling(createClickableCommand("/levelhead display header text <value>"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} to change it."))
        sendMessage(msg)
        sendDisplayHeaderColorHelp()
    }

    private fun sendDisplayHeaderColorHelp() {
        val msg = ChatComponentText("${ChatColor.YELLOW}Current header color: ${ChatColor.GOLD}${formatColor(currentHeaderColor())}${ChatColor.YELLOW}. Use ")
            .appendSibling(createClickableCommand("/levelhead display header color <color>"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} with a hex code, RGB value, or "))
            .appendSibling(getMinecraftColorNameHelpComponent())
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
        sendMessage(msg)
    }

    private fun sendDisplayOffsetDetails() {
        val offset = Levelhead.displayManager.config.offset
        val msg = ChatComponentText("${ChatColor.YELLOW}Current display offset: ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", offset)}${ChatColor.YELLOW}. Use ")
            .appendSibling(createClickableCommand("/levelhead display offset <value>"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} with a value between "))
            .appendSibling(ChatComponentText(String.format(Locale.ROOT, "%.1f", MIN_DISPLAY_OFFSET)).apply { chatStyle.color = ChatColor.GOLD })
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} and "))
            .appendSibling(ChatComponentText(String.format(Locale.ROOT, "%.1f", MAX_DISPLAY_OFFSET)).apply { chatStyle.color = ChatColor.GOLD })
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
        sendMessage(msg)
    }

    private fun sendDisplayShowSelfDetails() {
        val msg = ChatComponentText("${ChatColor.YELLOW}Self display visibility is currently ${formatToggle(currentShowSelf())}${ChatColor.YELLOW}. Use ")
            .appendSibling(createClickableCommand("/levelhead display showself <on|off>"))
            .appendSibling(ChatComponentText("${ChatColor.YELLOW} to change it."))
        sendMessage(msg)
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
            "on", "enable", "enabled", "true", "yes", "1" -> true
            "off", "disable", "disabled", "false", "no", "0" -> false
            else -> null
        }
    }

    private fun parseColor(input: String): Color? {
        val normalized = input.trim()
        if (HEX_COLOR_PATTERN.matches(normalized)) {
            val hex = normalized.removePrefix("#")
            return runCatching { Color(Integer.parseInt(hex, 16)) }.getOrNull()
        }
        RGB_COLOR_PATTERN.find(normalized)?.let { match ->
            val (r, g, b) = match.destructured
            val red = r.toInt().coerceIn(0, 255)
            val green = g.toInt().coerceIn(0, 255)
            val blue = b.toInt().coerceIn(0, 255)
            return Color(red, green, blue)
        }
        val key = normalized.replace(" ", "_").lowercase(Locale.ROOT)
        return NAMED_COLORS[key]
    }

    private fun formatColor(color: Color): String = "#%06X".format(Locale.ROOT, color.rgb and 0xFFFFFF)

    private suspend fun validateApiKey(key: String): Boolean = withContext(Dispatchers.IO) {
        val url = HttpUrl.parse("https://api.hypixel.net/key") ?: return@withContext false

        val request = Request.Builder()
            .url(url)
            .header("API-Key", key)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .get()
            .build()

        runCatching {
            Levelhead.okHttpClient.newCall(request).await().use { response ->
                response.isSuccessful
            }
        }.getOrDefault(false)
    }

    private fun isProxyFullyConfigured(): Boolean {
        return LevelheadConfig.proxyEnabled && LevelheadConfig.proxyBaseUrl.isNotBlank() && LevelheadConfig.proxyAuthToken.isNotBlank()
    }

    private suspend fun purgeProxyCache(identifier: String?): Int = withContext(Dispatchers.IO) {
        val baseUrl = LevelheadConfig.proxyBaseUrl.trim()
        val url = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.addPathSegment("admin")
            ?.addPathSegment("cache")
            ?.addPathSegment("purge")
            ?.build()
            ?: throw CommandException("Invalid proxy URL configured. Update it via /levelhead proxy url.")

        val payload = JsonObject().apply {
            identifier?.let { addProperty("identifier", it) }
        }
        val requestBody = RequestBody.create(JSON_MEDIA_TYPE, payload.toString())
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .header("X-Levelhead-Install", LevelheadConfig.installId)
            .header("Authorization", "Bearer ${LevelheadConfig.proxyAuthToken}")
            .post(requestBody)
            .build()

        Levelhead.okHttpClient.newCall(request).await().use { response ->
            val body = response.body()?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = runCatching {
                    JsonParser.parseString(body).asJsonObject.get("message")?.asString
                }.getOrNull()
                throw CommandException(message ?: "Proxy returned HTTP ${response.code()} while purging cache.")
            }

            val json = runCatching { JsonParser.parseString(body).asJsonObject }.getOrElse {
                throw CommandException("Proxy responded with unexpected body.")
            }
            json.get("purged")?.asInt ?: 0
        }
    }

    private fun getDeveloperKeyHelpMessage(): IChatComponent {
        val developerUrl = "https://developer.hypixel.net"
        val developerHost = "developer.hypixel.net"
        return ChatComponentText("${ChatColor.YELLOW}Get a new key at ")
            .appendSibling(ChatComponentText("${ChatColor.GOLD}$developerHost").apply {
                chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.OPEN_URL, developerUrl)
                chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to open"))
            })
            .appendSibling(ChatComponentText("${ChatColor.YELLOW}."))
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

}
