package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.dashUUID
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import cc.polyfrost.oneconfig.utils.commands.annotations.SubCommand
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.minecraft.entity.player.EntityPlayer
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import java.awt.Color
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.text.RegexOption
import kotlin.coroutines.resume

@Command(name = "levelhead", aliases = ["lh"])
class LevelheadCommand {

    companion object {
        private val API_KEY_PATTERN = Regex("^[a-f0-9]{32}$", RegexOption.IGNORE_CASE)
        private val UUID_WITH_DASH_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
        private val UUID_NO_DASH_PATTERN = Regex("^[0-9a-f]{32}$", RegexOption.IGNORE_CASE)
        private val IGN_PATTERN = Regex("^[a-zA-Z0-9_]{1,16}$")
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
        val header = primaryDisplay?.config?.headerString ?: BedwarsModeDetector.DEFAULT_HEADER
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

    @SubCommand(name = "apikey", aliases = ["setapikey"])
    fun handleApiKey(key: String) {
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

        LevelheadConfig.setApiKey(sanitized)
        sendMessage("${ChatColor.GREEN}Saved Hypixel API key for BedWars stat fetching.")
        resetBedwarsFetcher()
    }

    @SubCommand(name = "clearapikey")
    fun handleClearApiKey() {
        LevelheadConfig.clearApiKey()
        sendMessage("${ChatColor.GREEN}Cleared stored Hypixel API key.")
        resetBedwarsFetcher()
    }

    @SubCommand(name = "reload")
    fun handleReload() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        sendMessage("${ChatColor.GREEN}Reloaded BedWars star cache.")
    }

    @SubCommand(name = "enable")
    fun handleEnable() {
        updateEnabledState(true)
    }

    @SubCommand(name = "disable")
    fun handleDisable() {
        updateEnabledState(false)
    }

    @SubCommand(name = "toggle")
    fun handleToggle() {
        updateEnabledState(!Levelhead.displayManager.config.enabled)
    }

    @SubCommand(name = "mod", aliases = ["power"])
    fun handleMod(state: String) {
        val toggle = parseToggle(state)
        if (toggle == null) {
            sendMessage(
                "${ChatColor.RED}Couldn't understand '$state'.${ChatColor.YELLOW} Toggle the mod with ${ChatColor.GOLD}/levelhead mod <on|off>${ChatColor.YELLOW}. Current state: ${formatToggle(Levelhead.displayManager.config.enabled)}${ChatColor.YELLOW}."
            )
            return
        }
        updateEnabledState(toggle)
    }

    @SubCommand(name = "gui")
    fun handleGui() {
        val minecraft = Minecraft.getMinecraft()
        minecraft.addScheduledTask {
            LevelheadConfig.openGui()
        }
    }

    @SubCommand(name = "status")
    fun handleStatus() {
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

    @SubCommand(name = "cachettl")
    fun handleCacheTtl(minutesInput: String) {
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
        LevelheadConfig.setStarCacheTtlMinutes(clamped)
        Levelhead.clearCachedStats()
        sendMessage("${ChatColor.GREEN}Updated BedWars star cache TTL to ${ChatColor.GOLD}${clamped} minutes${ChatColor.GREEN}.")
    }

    @SubCommand(name = "display")
    fun handleDisplay(vararg args: String) {
        if (args.isEmpty()) {
            sendDisplayOverview()
            sendDisplayUsage()
            return
        }
        when (args[0].lowercase(Locale.ROOT)) {
            "header" -> handleDisplayHeader(args.drop(1).toTypedArray())
            "offset" -> handleDisplayOffset(args.drop(1).toTypedArray())
            "showself" -> handleDisplayShowSelf(args.drop(1).toTypedArray())
            else -> {
                sendMessage("${ChatColor.RED}Unknown display option '${args[0]}'.")
                sendDisplayUsage()
            }
        }
    }

    @SubCommand(name = "proxy")
    fun handleProxy(vararg args: String) {
        if (args.isEmpty()) {
            val status = when {
                !LevelheadConfig.proxyEnabled -> "${ChatColor.GRAY}disabled"
                LevelheadConfig.proxyBaseUrl.isBlank() || LevelheadConfig.proxyAuthToken.isBlank() -> "${ChatColor.RED}misconfigured"
                else -> "${ChatColor.GREEN}configured"
            }
            sendMessage("${ChatColor.YELLOW}Proxy is currently $status${ChatColor.YELLOW}.")
            sendProxyHelp()
            return
        }

        when (args[0].lowercase(Locale.ROOT)) {
            "enable", "on" -> {
                LevelheadConfig.setProxyEnabled(true)
                sendMessage("${ChatColor.GREEN}Enabled proxy usage for BedWars stats.")
                resetBedwarsFetcher()
            }
            "disable", "off" -> {
                LevelheadConfig.setProxyEnabled(false)
                sendMessage("${ChatColor.YELLOW}Disabled proxy usage. Hypixel API key will be used directly.")
                resetBedwarsFetcher()
            }
            "url" -> {
                val url = args.getOrNull(1)?.trim()
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
                LevelheadConfig.setProxyBaseUrl(sanitized)
                sendMessage("${ChatColor.GREEN}Updated proxy base URL to ${ChatColor.GOLD}$sanitized${ChatColor.GREEN}.")
                resetBedwarsFetcher()
            }
            "token" -> {
                val token = args.getOrNull(1)?.trim()
                if (token.isNullOrEmpty()) {
                    val currentState = if (LevelheadConfig.proxyAuthToken.isBlank()) "not set" else "configured"
                    sendMessage(
                        "${ChatColor.RED}Provide the proxy auth token.${ChatColor.YELLOW} Current token: ${ChatColor.GOLD}$currentState${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead proxy token <token>${ChatColor.YELLOW}."
                    )
                    return
                }
                LevelheadConfig.setProxyAuthToken(token)
                sendMessage("${ChatColor.GREEN}Updated proxy token.")
                resetBedwarsFetcher()
            }
            else -> {
                sendMessage("${ChatColor.RED}Unknown proxy option '${args[0]}'.")
                sendProxyHelp()
            }
        }
    }

    @SubCommand(name = "admin")
    fun handleAdmin(vararg args: String) {
        if (args.isEmpty()) {
            sendAdminHelp()
            return
        }
        when (args[0].lowercase(Locale.ROOT)) {
            "purgecache" -> handleAdminPurgeCache(args.drop(1).toTypedArray())
            else -> {
                sendMessage("${ChatColor.RED}Unknown admin action '${args[0]}'.")
                sendAdminHelp()
            }
        }
    }

    @SubCommand(name = "whois")
    fun handleWhois(vararg args: String) {
        val identifier = args.joinToString(" ").trim()
        if (identifier.isEmpty()) {
            sendMessage(
                "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Run ${ChatColor.GOLD}/levelhead whois <player|uuid>${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."
            )
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up BedWars stats for ${ChatColor.GOLD}$identifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val result = lookupWhois(identifier)
                Minecraft.getMinecraft().addScheduledTask {
                    val starText = result.star?.let { "${ChatColor.GOLD}$it✪" } ?: "${ChatColor.RED}?"
                    val experienceText = result.experience?.let { "${ChatColor.GOLD}$it" } ?: "${ChatColor.GRAY}unknown"
                    val nickedText = if (result.nicked) " ${ChatColor.GRAY}(nicked)" else ""
                    sendMessage(
                        "${ChatColor.YELLOW}${result.displayName}$nickedText ${ChatColor.YELLOW}is $starText ${ChatColor.YELLOW}(${ChatColor.AQUA}${result.source}${ChatColor.YELLOW}, XP: $experienceText)"
                    )
                }
            } catch (ex: CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}${ex.message}")
                }
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve BedWars stats for {}", identifier, throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}Unexpected error while fetching stats. Check logs for details.")
                }
            }
        }
    }

    @SubCommand(name = "debug")
    fun handleDebug() {
        val context = BedwarsModeDetector.currentContext()
        val snapshot = Levelhead.statusSnapshot()
        val displayCache = Levelhead.displayManager.aboveHead.sumOf { it.cache.size }
        sendMessage("${ChatColor.GREEN}Debug info:")
        sendMessage("${ChatColor.YELLOW}Context: ${ChatColor.GOLD}${context.name.lowercase(Locale.ROOT)}")
        sendMessage("${ChatColor.YELLOW}Mod enabled: ${formatToggle(Levelhead.displayManager.config.enabled)}${ChatColor.YELLOW}, show self: ${formatToggle(Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true)}")
        sendMessage("${ChatColor.YELLOW}Star cache entries: ${ChatColor.GOLD}${snapshot.cacheSize}${ChatColor.YELLOW}, display cache entries: ${ChatColor.GOLD}$displayCache")
        sendMessage("${ChatColor.YELLOW}Rate limiter remaining: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW}, proxy: ${if (snapshot.proxyEnabled) ChatColor.GREEN else ChatColor.GRAY}${if (snapshot.proxyEnabled) "enabled" else "disabled"}${ChatColor.YELLOW}")
    }

    private fun handleDisplayHeader(args: Array<String>) {
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
            "chroma" -> {
                val toggle = args.getOrNull(1)?.let { parseToggle(it) }
                if (toggle == null) {
                    sendMessage(
                        "${ChatColor.RED}Specify whether chroma should be on or off.${ChatColor.YELLOW} Current setting: ${formatToggle(currentHeaderChroma())}${ChatColor.YELLOW}."
                    )
                    return
                }
                val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
                    if (config.headerChroma == toggle) return@updatePrimaryDisplay false
                    config.headerChroma = toggle
                    true
                }
                if (changed) {
                    Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
                    sendMessage("${ChatColor.GREEN}Header chroma ${if (toggle) "enabled" else "disabled"}.")
                } else {
                    sendMessage("${ChatColor.YELLOW}Header chroma already ${if (toggle) "enabled" else "disabled"}.")
                }
            }
            else -> {
                sendMessage(
                    "${ChatColor.RED}Unknown header option '${args[0]}'."
                )
                sendDisplayHeaderDetails()
            }
        }
    }

    private fun handleDisplayOffset(args: Array<String>) {
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

    private fun handleDisplayShowSelf(args: Array<String>) {
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

    private fun handleAdminPurgeCache(args: Array<String>) {
        if (!isProxyFullyConfigured()) {
            sendMessage("${ChatColor.RED}Proxy must be enabled and configured to purge the backend cache.")
            return
        }
        val identifier = args.joinToString(" ").trim()
            .takeIf { it.isNotEmpty() }
            ?.let { raw ->
                val collapsed = raw.replace("-", "")
                if (UUID_NO_DASH_PATTERN.matches(collapsed)) collapsed.lowercase(Locale.ROOT) else raw
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
        val headerText = primaryDisplay?.config?.headerString ?: BedwarsModeDetector.DEFAULT_HEADER
        val headerColor = primaryDisplay?.config?.headerColor ?: Color(85, 255, 255)
        val headerChroma = primaryDisplay?.config?.headerChroma ?: false
        val showSelf = primaryDisplay?.config?.showSelf ?: true
        val offset = Levelhead.displayManager.config.offset

        sendMessage(
            "${ChatColor.YELLOW}Primary header: ${ChatColor.GOLD}$headerText${ChatColor.YELLOW} (${ChatColor.GOLD}${formatColor(headerColor)}${ChatColor.YELLOW}, chroma ${formatToggle(headerChroma)}${ChatColor.YELLOW})."
        )
        sendMessage(
            "${ChatColor.YELLOW}Display offset: ${ChatColor.GOLD}${String.format(Locale.ROOT, "%.2f", offset)}${ChatColor.YELLOW}, show self ${formatToggle(showSelf)}${ChatColor.YELLOW}."
        )
    }

    private fun sendDisplayUsage() {
        sendMessage(
            "${ChatColor.GRAY}Use ${ChatColor.GOLD}/levelhead display header <text|color|chroma>${ChatColor.GRAY}, ${ChatColor.GOLD}/levelhead display offset <value>${ChatColor.GRAY}, ${ChatColor.GOLD}/levelhead display showself <on|off>${ChatColor.GRAY} to make changes."
        )
    }

    private fun sendDisplayHeaderDetails() {
        sendMessage(
            "${ChatColor.YELLOW}Current header text: ${ChatColor.GOLD}${currentHeaderText()}${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead display header text <value>${ChatColor.YELLOW} to change it."
        )
        sendDisplayHeaderColorHelp()
        sendMessage(
            "${ChatColor.YELLOW}Header chroma: ${formatToggle(currentHeaderChroma())}${ChatColor.YELLOW}. Use ${ChatColor.GOLD}/levelhead display header chroma <on|off>${ChatColor.YELLOW} to toggle it."
        )
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
        return Levelhead.displayManager.primaryDisplay()?.config?.headerString ?: BedwarsModeDetector.DEFAULT_HEADER
    }

    private fun currentHeaderColor(): Color {
        return Levelhead.displayManager.primaryDisplay()?.config?.headerColor ?: Color(85, 255, 255)
    }

    private fun currentHeaderChroma(): Boolean {
        return Levelhead.displayManager.primaryDisplay()?.config?.headerChroma ?: false
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

    private suspend fun lookupWhois(identifier: String): WhoisResult {
        return if (isProxyFullyConfigured()) {
            fetchWhoisFromProxy(identifier)
        } else {
            val resolved = resolvePlayerIdentifier(identifier)
                ?: throw CommandException("Could not resolve '$identifier' to a player UUID.")
            fetchWhoisFromHypixel(resolved)
        }
    }

    private suspend fun fetchWhoisFromProxy(identifier: String): WhoisResult = withContext(Dispatchers.IO) {
        Levelhead.rateLimiter.consume()
        when (val result = BedwarsFetcher.fetchProxyPlayer(identifier, null)) {
            is BedwarsFetcher.FetchResult.Success -> parseWhoisResult(result.payload, identifier, source = "proxy")
            BedwarsFetcher.FetchResult.NotModified -> throw CommandException("Proxy returned no updates for $identifier.")
            is BedwarsFetcher.FetchResult.TemporaryError -> throw CommandException("Proxy temporarily unavailable (${result.reason ?: "unknown"}).")
            is BedwarsFetcher.FetchResult.PermanentError -> throw CommandException(
                when (result.reason) {
                    "PROXY_DISABLED" -> "Proxy is disabled. Configure it or use a UUID."
                    else -> "Proxy rejected the request (${result.reason ?: "unknown"})."
                }
            )
        }
    }

    private suspend fun fetchWhoisFromHypixel(resolved: ResolvedIdentifier): WhoisResult = withContext(Dispatchers.IO) {
        Levelhead.rateLimiter.consume()
        when (val result = BedwarsFetcher.fetchPlayer(resolved.uuid, null)) {
            is BedwarsFetcher.FetchResult.Success -> parseWhoisResult(result.payload, resolved.displayName ?: resolved.uuid.toString(), source = "hypixel")
            BedwarsFetcher.FetchResult.NotModified -> throw CommandException("No fresh data available for ${resolved.displayName ?: resolved.uuid}.")
            is BedwarsFetcher.FetchResult.TemporaryError -> throw CommandException("Hypixel temporarily unavailable (${result.reason ?: "unknown"}).")
            is BedwarsFetcher.FetchResult.PermanentError -> throw CommandException(
                when (result.reason) {
                    "MISSING_KEY" -> "Set your Hypixel API key with /levelhead apikey <key> to query players."
                    else -> "Hypixel request failed (${result.reason ?: "unknown"})."
                }
            )
        }
    }

    private fun parseWhoisResult(payload: JsonObject, fallbackName: String, source: String): WhoisResult {
        val experience = BedwarsStar.extractExperience(payload)
        val star = experience?.let { BedwarsStar.calculateStar(it) }
        val nicked = payload.get("nicked")?.asBoolean == true
        val displayName = payload.get("display")?.asString
            ?: payload.getAsJsonObject("player")?.get("displayname")?.asString
            ?: fallbackName
        return WhoisResult(displayName = displayName, star = star, experience = experience, nicked = nicked, source = source)
    }

    private suspend fun resolvePlayerIdentifier(input: String): ResolvedIdentifier? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) {
            return null
        }

        val localMatch = resolveLocalPlayer(trimmed)
        if (localMatch != null) {
            return ResolvedIdentifier(localMatch.uniqueID, localMatch.name)
        }

        when {
            UUID_WITH_DASH_PATTERN.matches(trimmed) -> {
                return runCatching { UUID.fromString(trimmed) }.map { ResolvedIdentifier(it, null) }.getOrNull()
            }
            UUID_NO_DASH_PATTERN.matches(trimmed) -> {
                val uuid = trimmed.lowercase(Locale.ROOT).dashUUID
                if (uuid != null) {
                    return ResolvedIdentifier(uuid, null)
                }
            }
            IGN_PATTERN.matches(trimmed) -> {
                val resolved = lookupUuidForIgn(trimmed)
                if (resolved != null) {
                    return ResolvedIdentifier(resolved.first, resolved.second)
                }
            }
        }
        return null
    }

    private suspend fun resolveLocalPlayer(trimmed: String): EntityPlayer? = suspendCancellableCoroutine { continuation ->
        val minecraft = Minecraft.getMinecraft()

        minecraft.addScheduledTask {
            val match = Minecraft.getMinecraft().theWorld
                ?.playerEntities
                ?.firstOrNull { player ->
                    player.name.equals(trimmed, true) || player.gameProfile?.name?.equals(trimmed, true) == true
                }
            if (continuation.isActive) {
                continuation.resume(match)
            }
        }
    }

    private suspend fun lookupUuidForIgn(ign: String): Pair<UUID, String>? = withContext(Dispatchers.IO) {
        val url = HttpUrl.parse("https://api.mojang.com/users/profiles/minecraft/$ign")
            ?: return@withContext null
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .get()
            .build()

        Levelhead.okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                if (response.code() == 204 || response.code() == 404) {
                    return@withContext null
                }
                throw CommandException("Mojang profile lookup failed with HTTP ${response.code()}.")
            }
            val body = response.body()?.string().orEmpty()
            if (body.isEmpty()) {
                return@withContext null
            }
            val json = runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrNull() ?: return@withContext null
            val id = json.get("id")?.asString ?: return@withContext null
            val uuid = id.dashUUID ?: return@withContext null
            val name = json.get("name")?.asString ?: ign
            uuid to name
        }
    }

    private data class WhoisResult(
        val displayName: String,
        val star: Int?,
        val experience: Long?,
        val nicked: Boolean,
        val source: String,
    )

    private data class ResolvedIdentifier(val uuid: UUID, val displayName: String?)

    private class CommandException(message: String) : Exception(message)
}

