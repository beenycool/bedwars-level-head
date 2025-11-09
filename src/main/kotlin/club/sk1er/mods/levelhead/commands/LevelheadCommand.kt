package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.gui.LevelheadToggleScreen
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.command.CommandBase
import net.minecraft.command.ICommandSender
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.ChatComponentText
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
import kotlin.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LevelheadCommand : CommandBase() {

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
    }

    override fun getCommandName() = "levelhead"
    override fun getCommandUsage(sender: ICommandSender) = "/levelhead"
    override fun getRequiredPermissionLevel() = 0

    override fun processCommand(sender: ICommandSender, args: Array<String>) {
        if (args.isEmpty()) {
            sendDisplayOverview()
            sendDisplayUsage()
            return
        }
        when (args[0].lowercase(Locale.ROOT)) {
            "apikey", "setapikey" -> if (args.size >= 2) handleApiKey(args[1]) else sendMessage("Provide an API key.")
            "clearapikey" -> handleClearApiKey()
            "reload" -> handleReload()
            "enable" -> handleEnable()
            "disable" -> handleDisable()
            "toggle" -> handleToggle()
            "mod", "power" -> if (args.size >= 2) handleMod(args[1]) else sendMessage("Provide on/off.")
            "gui" -> handleGui()
            "status" -> handleStatus()
            "cachettl" -> if (args.size >= 2) handleCacheTtl(args[1]) else sendMessage("Provide TTL in minutes.")
            "display" -> handleDisplay(*args.drop(1).toTypedArray())
            "proxy" -> handleProxy(*args.drop(1).toTypedArray())
            "admin" -> handleAdmin(*args.drop(1).toTypedArray())
            "whois" -> handleWhois(*args.drop(1).toTypedArray())
            "debug" -> handleDebug()
            else -> {
                sendMessage("Unknown subcommand. Run /levelhead for help.")
                sendDisplayUsage()
            }
        }
    }

    private fun sendMessage(message: String) {
        val mc = Minecraft.getMinecraft()
        mc.thePlayer?.addChatMessage(ChatComponentText(message))
    }

    private fun handleApiKey(key: String) {
        if (key.equals("clear", ignoreCase = true)) {
            LevelheadConfig.clearApiKey()
            sendMessage("Cleared stored Hypixel API key.")
            resetBedwarsFetcher()
            return
        }
        val sanitized = key.trim()
        val normalized = sanitized.replace("-", "")
        if (!API_KEY_PATTERN.matches(normalized)) {
            sendMessage("Invalid Hypixel API key. Keys should be 32 hexadecimal characters.")
            return
        }
        LevelheadConfig.setApiKey(sanitized)
        sendMessage("Saved Hypixel API key for BedWars stat fetching.")
        resetBedwarsFetcher()
    }

    private fun handleClearApiKey() {
        LevelheadConfig.clearApiKey()
        sendMessage("Cleared stored Hypixel API key.")
        resetBedwarsFetcher()
    }

    private fun handleReload() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        sendMessage("Reloaded BedWars star cache.")
    }

    private fun handleEnable() = updateEnabledState(true)
    private fun handleDisable() = updateEnabledState(false)
    private fun handleToggle() = updateEnabledState(!Levelhead.displayManager.config.enabled)

    private fun handleMod(state: String) {
        val toggle = parseToggle(state)
        if (toggle == null) {
            sendMessage("Couldn't understand '$state'. Use /levelhead mod <on|off>.")
            return
        }
        updateEnabledState(toggle)
    }

    private fun handleGui() {
        val minecraft = Minecraft.getMinecraft()
        minecraft.addScheduledTask {
            minecraft.displayGuiScreen(LevelheadToggleScreen())
        }
    }

    private fun handleStatus() {
        val snapshot = Levelhead.statusSnapshot()
        val proxyStatus = when {
            !snapshot.proxyEnabled -> "disabled"
            snapshot.proxyConfigured -> "configured"
            else -> "missing config"
        }
        val lastAttempt = formatAge(snapshot.lastAttemptAgeMillis)
        val lastSuccess = formatAge(snapshot.lastSuccessAgeMillis)
        val rateReset = formatAge(snapshot.rateLimitResetMillis)
        val serverCooldown = snapshot.serverCooldownMillis?.let { formatAge(it) }

        sendMessage("Status snapshot:")
        sendMessage("Proxy: $proxyStatus")
        sendMessage("Cache size: ${snapshot.cacheSize}")
        sendMessage("Star cache TTL: ${snapshot.starCacheTtlMinutes}m (cold misses: ${snapshot.cacheMissesCold}, expired refreshes: ${snapshot.cacheMissesExpired})")
        sendMessage("Last request: $lastAttempt ago")
        sendMessage("Last success: $lastSuccess ago")
        sendMessage("Rate limit: ${snapshot.rateLimitRemaining} remaining, resets in $rateReset")
        serverCooldown?.let { sendMessage("Server cooldown: $it remaining") }
    }

    private fun handleCacheTtl(minutesInput: String) {
        val parsed = minutesInput.trim().toIntOrNull()
        if (parsed == null) {
            val current = LevelheadConfig.starCacheTtlMinutes
            sendMessage("Couldn't read '$minutesInput'. Choose minutes between ${LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES} and ${LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES}. Current TTL: $current.")
            return
        }
        val clamped = parsed.coerceIn(LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES, LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES)
        LevelheadConfig.setStarCacheTtlMinutes(clamped)
        Levelhead.clearCachedStars()
        sendMessage("Updated BedWars star cache TTL to $clamped minutes.")
    }

    private fun handleDisplay(vararg args: String) {
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
                sendMessage("Unknown display option '${args[0]}'.")
                sendDisplayUsage()
            }
        }
    }

    private fun handleProxy(vararg args: String) {
        if (args.isEmpty()) {
            val status = when {
                !LevelheadConfig.proxyEnabled -> "disabled"
                LevelheadConfig.proxyBaseUrl.isBlank() || LevelheadConfig.proxyAuthToken.isBlank() -> "misconfigured"
                else -> "configured"
            }
            sendMessage("Proxy is currently $status.")
            sendProxyHelp()
            return
        }
        when (args[0].lowercase(Locale.ROOT)) {
            "enable", "on" -> {
                LevelheadConfig.setProxyEnabled(true)
                sendMessage("Enabled proxy usage for BedWars stats.")
                resetBedwarsFetcher()
            }
            "disable", "off" -> {
                LevelheadConfig.setProxyEnabled(false)
                sendMessage("Disabled proxy usage. Hypixel API key will be used directly.")
                resetBedwarsFetcher()
            }
            "url" -> {
                val url = args.getOrNull(1)?.trim()
                if (url.isNullOrEmpty()) {
                    val current = LevelheadConfig.proxyBaseUrl.ifBlank { "not set" }
                    sendMessage("Provide the proxy base URL. Current URL: $current.")
                    return
                }
                val parsedUrl = HttpUrl.parse(url)
                if (parsedUrl == null || parsedUrl.scheme() !in setOf("http", "https")) {
                    sendMessage("Invalid proxy base URL. Use http or https.")
                    return
                }
                val sanitized = parsedUrl.newBuilder().query(null).fragment(null).build().toString().trimEnd('/')
                LevelheadConfig.setProxyBaseUrl(sanitized)
                sendMessage("Updated proxy base URL to $sanitized.")
                resetBedwarsFetcher()
            }
            "token" -> {
                val token = args.getOrNull(1)?.trim()
                if (token.isNullOrEmpty()) {
                    val currentState = if (LevelheadConfig.proxyAuthToken.isBlank()) "not set" else "configured"
                    sendMessage("Provide the proxy auth token. Current token: $currentState.")
                    return
                }
                LevelheadConfig.setProxyAuthToken(token)
                sendMessage("Updated proxy token.")
                resetBedwarsFetcher()
            }
            else -> {
                sendMessage("Unknown proxy option '${args[0]}'.")
                sendProxyHelp()
            }
        }
    }

    private fun handleAdmin(vararg args: String) {
        if (args.isEmpty()) {
            sendAdminHelp()
            return
        }
        when (args[0].lowercase(Locale.ROOT)) {
            "purgecache" -> handleAdminPurgeCache(args.drop(1).toTypedArray())
            else -> {
                sendMessage("Unknown admin action '${args[0]}'.")
                sendAdminHelp()
            }
        }
    }

    private fun handleWhois(vararg args: String) {
        val identifier = args.joinToString(" ").trim()
        if (identifier.isEmpty()) {
            sendMessage("Tell me who to inspect: /levelhead whois <player|uuid>.")
            return
        }
        sendMessage("Looking up BedWars stats for $identifier...")
        Levelhead.scope.launch {
            try {
                val result = lookupWhois(identifier)
                Minecraft.getMinecraft().addScheduledTask {
                    val starText = result.star?.let { "$it✪" } ?: "?"
                    val experienceText = result.experience?.toString() ?: "unknown"
                    val nickedText = if (result.nicked) " (nicked)" else ""
                    sendMessage("${result.displayName}$nickedText is $starText (source=${result.source}, XP=$experienceText)")
                }
            } catch (ex: CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage(ex.message ?: "Command failed.")
                }
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve BedWars stats for {}", identifier, throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("Unexpected error while fetching stats. Check logs for details.")
                }
            }
        }
    }

    private fun handleDebug() {
        val context = BedwarsModeDetector.currentContext()
        val snapshot = Levelhead.statusSnapshot()
        val displayCache = Levelhead.displayManager.aboveHead.sumOf { it.cache.size }
        sendMessage("Debug info:")
        sendMessage("Context: ${context.name.lowercase(Locale.ROOT)}")
        sendMessage("Mod enabled: ${Levelhead.displayManager.config.enabled}, show self: ${Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true}")
        sendMessage("Star cache entries: ${snapshot.cacheSize}, display cache entries: $displayCache")
        sendMessage("Rate limiter remaining: ${snapshot.rateLimitRemaining}, proxy: ${if (snapshot.proxyEnabled) "enabled" else "disabled"}")
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
                    sendMessage("Header text cannot be empty. Current header: ${currentHeaderText()}.")
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
                    sendMessage("Updated header text to $sanitized.")
                } else {
                    sendMessage("Header text is already set to $sanitized.")
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
                    sendMessage("Unable to parse color '$colorInput'. Try a hex code (e.g. #ff00ff), RGB (r,g,b), or a Minecraft color name. Current header color: ${formatColor(currentHeaderColor())}.")
                    return
                }
                val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
                    if (config.headerColor == color) return@updatePrimaryDisplay false
                    config.headerColor = color
                    true
                }
                if (changed) {
                    Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
                    sendMessage("Updated header color to ${formatColor(color)}.")
                } else {
                    sendMessage("Header color is already ${formatColor(color)}.")
                }
            }
            "chroma" -> {
                val toggle = args.getOrNull(1)?.let { parseToggle(it) }
                if (toggle == null) {
                    sendMessage("Specify whether chroma should be on or off. Current setting: ${formatToggle(currentHeaderChroma())}. Use /levelhead display header chroma <on|off>.")
                    return
                }
                val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
                    if (config.headerChroma == toggle) return@updatePrimaryDisplay false
                    config.headerChroma = toggle
                    true
                }
                if (changed) {
                    Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
                    sendMessage("Header chroma ${if (toggle) "enabled" else "disabled"}.")
                } else {
                    sendMessage("Header chroma already ${if (toggle) "enabled" else "disabled"}.")
                }
            }
            else -> {
                sendMessage("Unknown header option '${args[0]}'.")
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
            sendMessage("Offset already set to ${String.format(Locale.ROOT, "%.2f", clamped)}.")
            return
        }
        Levelhead.displayManager.config.offset = clamped
        Levelhead.displayManager.saveConfig()
        sendMessage("Updated display offset to ${String.format(Locale.ROOT, "%.2f", clamped)}.")
    }

    private fun handleDisplayShowSelf(args: Array<String>) {
        if (args.isEmpty()) {
            sendDisplayShowSelfDetails()
            return
        }
        val toggle = args.getOrNull(0)?.let { parseToggle(it) }
        if (toggle == null) {
            sendMessage("Couldn't understand '${args[0]}'. Use /levelhead display showself <on|off>.")
            return
        }
        val changed = Levelhead.displayManager.updatePrimaryDisplay { config ->
            if (config.showSelf == toggle) return@updatePrimaryDisplay false
            config.showSelf = toggle
            true
        }
        if (changed) {
            sendMessage("Updated self display visibility to ${formatToggle(toggle)}.")
        } else {
            sendMessage("Self display visibility already ${formatToggle(toggle)}.")
        }
    }

    private fun handleAdminPurgeCache(args: Array<String>) {
        if (!isProxyFullyConfigured()) {
            sendMessage("Proxy must be enabled and configured to purge the backend cache.")
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
                    val scopeText = identifier?.let { "for $it" } ?: "globally"
                    sendMessage("Requested cache purge $scopeText ($purged entries).")
                }
            } catch (ex: CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage(ex.message ?: "Command failed.")
                }
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to purge proxy cache", throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("Unexpected error while purging cache. Check logs for details.")
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
        sendMessage("Options: enable/disable toggle usage ($enabledState), url to set the backend ($baseUrl), token to update auth ($tokenState).")
        sendMessage("Try: /levelhead proxy enable, /levelhead proxy url https://example.com, /levelhead proxy token <token>.")
    }

    private fun sendAdminHelp() {
        sendMessage("Admin commands control the proxy cache. Available: purgecache [player] to clear cached stats globally or for a specific player.")
        sendMessage("Example: /levelhead admin purgecache (all) or /levelhead admin purgecache Notch.")
    }

    private fun sendStatus(message: String) {
        sendMessage(message)
    }

    private fun updateEnabledState(enabled: Boolean) {
        val changed = Levelhead.displayManager.setEnabled(enabled)
        val stateText = if (enabled) "enabled" else "disabled"
        val color = if (enabled) Color.GREEN else Color.RED
        val message = if (changed) {
            "${color}BedWars Levelhead has been ${color}$stateText${ChatColor.YELLOW}."
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

    private fun sendDisplayOverview() {
        val primaryDisplay = Levelhead.displayManager.primaryDisplay()
        val headerText = primaryDisplay?.config?.headerString ?: BedwarsModeDetector.DEFAULT_HEADER
        val headerColor = primaryDisplay?.config?.headerColor ?: ChatColor.AQUA.color!!
        val headerChroma = primaryDisplay?.config?.headerChroma ?: false
        val showSelf = primaryDisplay?.config?.showSelf ?: true
        val offset = Levelhead.displayManager.config.offset

        sendMessage("Primary header: $headerText (${formatColor(headerColor)}, chroma ${formatToggle(headerChroma)}).")
        sendMessage("Display offset: ${String.format(Locale.ROOT, "%.2f", offset)}, show self ${formatToggle(showSelf)}.")
    }

    private fun sendDisplayUsage() {
        sendMessage("Use /levelhead display header <text|color|chroma>, /levelhead display offset <value>, /levelhead display showself <on|off> to make changes.")
    }

    private fun sendDisplayHeaderDetails() {
        sendMessage("Current header text: ${currentHeaderText()}. Use /levelhead display header text <value> to change it.")
        sendDisplayHeaderColorHelp()
        sendMessage("Header chroma: ${formatToggle(currentHeaderChroma())}. Use /levelhead display header chroma <on|off> to toggle it.")
    }

    private fun sendDisplayHeaderColorHelp() {
        sendMessage("Current header color: ${formatColor(currentHeaderColor())}. Use /levelhead display header color <color> with a hex code, RGB value, or Minecraft color name.")
    }

    private fun sendDisplayOffsetDetails() {
        val offset = Levelhead.displayManager.config.offset
        sendMessage("Current display offset: ${String.format(Locale.ROOT, "%.2f", offset)}. Provide a value between ${String.format(Locale.ROOT, "%.1f", MIN_DISPLAY_OFFSET)} and ${String.format(Locale.ROOT, "%.1f", MAX_DISPLAY_OFFSET)}.")
    }

    private fun sendDisplayShowSelfDetails() {
        sendMessage("Self display visibility is currently ${formatToggle(currentShowSelf())}. Use /levelhead display showself <on|off> to change it.")
    }

    private fun currentHeaderText(): String {
        return Levelhead.displayManager.primaryDisplay()?.config?.headerString ?: BedwarsModeDetector.DEFAULT_HEADER
    }

    private fun currentHeaderColor(): Color {
        return Levelhead.displayManager.primaryDisplay()?.config?.headerColor ?: ChatColor.AQUA.color!!
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
        return ChatColor.values()
            .firstOrNull { it.isColor() && it.name.equals(normalized.replace(" ", "_"), ignoreCase = true) }
            ?.color
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

    private suspend fun lookupWhois(identifier: String): WhoisResult = withContext(Dispatchers.IO) {
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
            val match = minecraft.theWorld
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

