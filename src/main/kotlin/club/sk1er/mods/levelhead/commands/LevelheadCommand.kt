package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.commands.WhoisService
import club.sk1er.mods.levelhead.config.ConfigProfiles
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.commands.WhoisService.CommandException
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Greedy
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import cc.polyfrost.oneconfig.utils.commands.annotations.SubCommand
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.GuiScreen
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
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

        sendMessage(
            "${ChatColor.AQUA}BedWars Levelhead ${ChatColor.GOLD}v${Levelhead.VERSION}${ChatColor.YELLOW}: " +
                "${enabledColor}${if (enabled) "enabled" else "disabled"}${ChatColor.YELLOW}."
        )
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
            sendMessage("${ChatColor.RED}Invalid Hypixel API key. Keys should be 32 hexadecimal characters.")
            return
        }

        LevelheadConfig.updateApiKey(sanitized)
        sendMessage("${ChatColor.GREEN}Saved Hypixel API key for BedWars stat fetching.")
        resetBedwarsFetcher()

        // Background validation of the API key
        Levelhead.scope.launch {
            val valid = validateApiKey(sanitized)
            if (!valid) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}Warning: That API key appears to be invalid (Hypixel rejected it).")
                }
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
            sendMessage(
                "${ChatColor.RED}Couldn't understand '$state'.${ChatColor.YELLOW} Toggle the mod with ${ChatColor.GOLD}/levelhead mod <on|off>${ChatColor.YELLOW}. Current state: ${formatToggle(Levelhead.displayManager.config.enabled)}${ChatColor.YELLOW}."
            )
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
                    sendMessage(
                        "${ChatColor.RED}Provide the proxy base URL.${ChatColor.YELLOW} Current URL: ${ChatColor.GOLD}$current${ChatColor.YELLOW}. Try ${ChatColor.GOLD}/levelhead proxy url <baseUrl>${ChatColor.YELLOW}."
                    )
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
                    sendMessage(
                        "${ChatColor.RED}Provide the proxy auth token.${ChatColor.YELLOW} Current token: ${ChatColor.GOLD}$currentState${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead proxy token <token>${ChatColor.YELLOW}."
                    )
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
            sendMessage(
                "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Run ${ChatColor.GOLD}/levelhead whois <player|uuid>${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."
            )
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val result = WhoisService.lookupWhois(trimmedIdentifier)
                Minecraft.getMinecraft().addScheduledTask {
                    val nickedText = if (result.nicked) " ${ChatColor.GRAY}(nicked)" else ""
                    sendMessage(
                        "${ChatColor.YELLOW}${result.displayName}$nickedText ${ChatColor.YELLOW}is ${ChatColor.GOLD}${result.statValue} ${ChatColor.YELLOW}(${result.gameMode.displayName} ${result.statName})"
                    )
                }
            } catch (ex: WhoisService.CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}${ex.message}")
                }
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}Unexpected error while fetching stats. Check logs for details.")
                }
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
        sendMessage("${ChatColor.GREEN}Debug info:")
        sendMessage("${ChatColor.YELLOW}Game Mode: ${ChatColor.GOLD}${gameMode?.displayName ?: "none"}")
        sendMessage("${ChatColor.YELLOW}Context: ${ChatColor.GOLD}${context?.name?.lowercase(Locale.ROOT) ?: "unknown"}")
        sendMessage("${ChatColor.YELLOW}Mod enabled: ${formatToggle(Levelhead.displayManager.config.enabled)}${ChatColor.YELLOW}, show self: ${formatToggle(Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true)}")
        sendMessage("${ChatColor.YELLOW}Cache size: ${ChatColor.GOLD}${snapshot.cacheSize}${ChatColor.YELLOW}, display cache entries: ${ChatColor.GOLD}$displayCache")
        sendMessage("${ChatColor.YELLOW}Rate limiter remaining: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW}, proxy: ${if (snapshot.proxyEnabled) ChatColor.GREEN else ChatColor.GRAY}${if (snapshot.proxyEnabled) "enabled" else "disabled"}${ChatColor.YELLOW}")
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
                    sendMessage("${ChatColor.YELLOW}- ${ChatColor.GOLD}${preset.displayName}${ChatColor.YELLOW}: ${ChatColor.GRAY}${preset.description}")
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
        sendMessage("${ChatColor.GRAY}  ${ChatColor.GOLD}/levelhead profile list${ChatColor.GRAY} - Show available presets")
        sendMessage("${ChatColor.GRAY}  ${ChatColor.GOLD}/levelhead profile apply <name>${ChatColor.GRAY} - Apply a preset")
        sendMessage("${ChatColor.GRAY}  ${ChatColor.GOLD}/levelhead profile export${ChatColor.GRAY} - Export config to clipboard")
        sendMessage("${ChatColor.GRAY}  ${ChatColor.GOLD}/levelhead profile import${ChatColor.GRAY} - Import config from clipboard")
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
                val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
                    if (config.headerString == sanitized) return@updatePrimaryDisplay false
                    config.headerString = sanitized
                    true
                }
                if (changed) {
                    Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
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
                    sendMessage(
                        "${ChatColor.RED}Unable to parse color '$colorInput'.${ChatColor.YELLOW} Try a hex code (e.g. ${ChatColor.GOLD}#ff00ff${ChatColor.YELLOW}), RGB (r,g,b), or a Minecraft color name.${ChatColor.YELLOW} Current header color: ${ChatColor.GOLD}${formatColor(currentHeaderColor())}${ChatColor.YELLOW}."
                    )
                    return
                }
                val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
                    if (config.headerColor == color) return@updatePrimaryDisplay false
                    config.headerColor = color
                    true
                }
                if (changed) {
                    Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
                    sendMessage("${ChatColor.GREEN}Updated header color to ${ChatColor.GOLD}${formatColor(color)}${ChatColor.GREEN}.")
                } else {
                    sendMessage("${ChatColor.YELLOW}Header color is already ${ChatColor.GOLD}${formatColor(color)}${ChatColor.YELLOW}.")
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
        val previous = Levelhead.displayManager.config.offset
        if (abs(previous - clamped) < 0.0001) {
            sendMessage("${ChatColor.YELLOW}Offset already set to ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", clamped)}${ChatColor.YELLOW}.")
            return
        }
        Levelhead.displayManager.config.offset = clamped
        Levelhead.displayManager.saveConfig()
        sendMessage("${ChatColor.GREEN}Updated display offset to ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", clamped)}${ChatColor.GREEN}.")
    }

    private fun handleDisplayShowSelf(args: List<String>) {
        if (args.isEmpty()) {
            sendDisplayShowSelfDetails()
            return
        }
        val toggle = args.getOrNull(0)?.let { parseToggle(it) }
        if (toggle == null) {
            sendMessage(
                "${ChatColor.RED}Couldn't understand '${args[0]}'.${ChatColor.YELLOW} Use ${ChatColor.GOLD}/levelhead display showself <on|off>${ChatColor.YELLOW}. Current setting: ${formatToggle(currentShowSelf())}${ChatColor.YELLOW}."
            )
            return
        }
        val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
            if (config.showSelf == toggle) return@updatePrimaryDisplay false
            config.showSelf = toggle
            true
        }
        if (changed) {
            sendMessage("${ChatColor.GREEN}Updated self display visibility to ${formatToggle(toggle)}${ChatColor.GREEN}.")
        } else {
            sendMessage("${ChatColor.YELLOW}Self display visibility already ${formatToggle(toggle)}${ChatColor.YELLOW}.")
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
        sendMessage(
            "${ChatColor.GRAY}Try:${ChatColor.GOLD} /levelhead proxy enable${ChatColor.YELLOW}, ${ChatColor.GOLD}/levelhead proxy url https://example.com${ChatColor.YELLOW}, ${ChatColor.GOLD}/levelhead proxy token <token>${ChatColor.YELLOW}."
        )
    }

    private fun sendAdminHelp() {
        sendMessage(
            "${ChatColor.YELLOW}Admin commands control the proxy cache.${ChatColor.GRAY} Available: ${ChatColor.GOLD}purgecache [player]${ChatColor.GRAY} to clear cached stats globally or for a specific player."
        )
        sendMessage(
            "${ChatColor.GRAY}Example:${ChatColor.GOLD} /levelhead admin purgecache${ChatColor.YELLOW} (all) or ${ChatColor.GOLD}/levelhead admin purgecache Notch${ChatColor.YELLOW}."
        )
    }

    private fun sendStatus(message: String) {
        sendMessage(message)
    }

    private fun updateEnabledState(enabled: Boolean) {
        val changed = Levelhead.displayManager.setEnabled(enabled)
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

    private fun sendMessage(message: String) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
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
        sendMessage(
            "${ChatColor.GRAY}Use ${ChatColor.GOLD}/levelhead display header <text|color>${ChatColor.GRAY}, ${ChatColor.GOLD}/levelhead display offset <value>${ChatColor.GRAY}, ${ChatColor.GOLD}/levelhead display showself <on|off>${ChatColor.GRAY} to make changes."
        )
    }

    private fun sendDisplayHeaderDetails() {
        sendMessage(
            "${ChatColor.YELLOW}Current header text: ${ChatColor.GOLD}${currentHeaderText()}${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead display header text <value>${ChatColor.YELLOW} to change it."
        )
        sendDisplayHeaderColorHelp()
    }

    private fun sendDisplayHeaderColorHelp() {
        sendMessage(
            "${ChatColor.YELLOW}Current header color: ${ChatColor.GOLD}${formatColor(currentHeaderColor())}${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead display header color <color>${ChatColor.YELLOW} with a hex code, RGB value, or Minecraft color name."
        )
    }

    private fun sendDisplayOffsetDetails() {
        val offset = Levelhead.displayManager.config.offset
        sendMessage(
            "${ChatColor.YELLOW}Current display offset: ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", offset)}${ChatColor.YELLOW}. Provide a value between ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.1f", MIN_DISPLAY_OFFSET)}${ChatColor.YELLOW} and ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.1f", MAX_DISPLAY_OFFSET)}${ChatColor.YELLOW}."
        )
    }

    private fun sendDisplayShowSelfDetails() {
        sendMessage(
            "${ChatColor.YELLOW}Self display visibility is currently ${formatToggle(currentShowSelf())}${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead display showself <on|off>${ChatColor.YELLOW} to change it."
        )
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
            .url(url.toString())
            .header("API-Key", key)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .get()
            .build()

        runCatching {
            Levelhead.okHttpClient.newCall(request).execute().use { response ->
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
            .url(url.toString())
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .header("X-Levelhead-Install", LevelheadConfig.installId)
            .header("Authorization", "Bearer ${LevelheadConfig.proxyAuthToken}")
            .post(requestBody)
            .build()

        Levelhead.okHttpClient.newCall(request).execute().use { response ->
            val body = response.body()?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = runCatching {
                    Levelhead.jsonParser.parse(body).asJsonObject.get("message")?.asString
                }.getOrNull()
                throw CommandException(message ?: "Proxy returned HTTP ${response.code()} while purging cache.")
            }

            val json = runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                throw CommandException("Proxy responded with unexpected body.")
            }
            json.get("purged")?.asInt ?: 0
        }
    }

}

