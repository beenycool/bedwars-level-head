package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.gui.LevelheadToggleScreen
import com.google.gson.JsonObject
import org.polyfrost.oneconfig.api.commands.v1.CommandManager
import org.polyfrost.oneconfig.api.commands.v1.factories.annotated.Command
import org.polyfrost.oneconfig.api.commands.v1.factories.annotated.Handler
import org.polyfrost.oneconfig.api.config.v1.UIManager
import dev.deftu.omnicore.api.client.chat.OmniClientChat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.minecraft.entity.player.EntityPlayer
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.text.RegexOption
import kotlin.coroutines.resume

@Command(value = ["levelhead", "lh"], description = "Main command for BedWars Levelhead mod")
object LevelheadCommand {

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

    @Handler
    fun main() {
        val enabled = MasterConfig.enabled
        val enabledColor = if (enabled) "§a" else "§c"
        val primaryDisplay = Levelhead.displayManager.primaryDisplay()
        val header = primaryDisplay?.config?.headerString ?: BedwarsModeDetector.DEFAULT_HEADER
        val showSelf = primaryDisplay?.config?.showSelf ?: true
        val offset = MasterConfig.offset
        val proxyState = when {
            !LevelheadConfig.proxyEnabledValue -> "§7disabled"
            LevelheadConfig.proxyBaseUrlValue.isBlank() || LevelheadConfig.proxyAuthTokenValue.isBlank() -> "§cmisconfigured"
            else -> "§aconfigured"
        }

        OmniClientChat.displayChatMessage("§bBedWars Levelhead §6v${Levelhead.VERSION}§f: " +
                "${enabledColor}${if (enabled) "enabled" else "disabled"}§f.")
        OmniClientChat.displayChatMessage("§fHeader: §6$header§f, " +
                "offset §6${String.format(Locale.ROOT, "%.2f", offset)}§f, " +
                "show self ${formatToggle(showSelf)}§f.")
        OmniClientChat.displayChatMessage("§fProxy: $proxyState§f. " +
                "§7Try §6/levelhead status§7 or §6/levelhead display§7 for more controls.")
    }

    // API Key commands
    @Command(value = ["apikey", "setapikey"])
    fun setApiKey(key: String) {
        if (key.equals("clear", ignoreCase = true)) {
            LevelheadConfig.clearApiKey()
            OmniClientChat.displayChatMessage("§aCleared stored Hypixel API key.")
            resetBedwarsFetcher()
            return
        }

        val sanitized = key.trim()
        val normalized = sanitized.replace("-", "")
        if (!API_KEY_PATTERN.matches(normalized)) {
            OmniClientChat.displayChatMessage("§cInvalid Hypixel API key. Keys should be 32 hexadecimal characters.")
            return
        }

        LevelheadConfig.setApiKey(sanitized)
        OmniClientChat.displayChatMessage("§aSaved Hypixel API key for BedWars stat fetching.")
        resetBedwarsFetcher()
    }

    @Command(value = ["clearapikey"])
    fun clearApiKey() {
        LevelheadConfig.clearApiKey()
        OmniClientChat.displayChatMessage("§aCleared stored Hypixel API key.")
        resetBedwarsFetcher()
    }

    // General mod commands
    @Command(value = ["reload"])
    fun reload() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        OmniClientChat.displayChatMessage("§aReloaded BedWars star cache.")
    }

    @Command(value = ["enable"])
    fun enable() {
        setEnabled(true)
    }

    @Command(value = ["disable"])
    fun disable() {
        setEnabled(false)
    }

    @Command(value = ["toggle"])
    fun toggle() {
        setEnabled(!MasterConfig.enabled)
    }

    @Command(value = ["mod", "power"])
    fun mod(state: String) {
        val toggle = parseToggle(state)
        if (toggle == null) {
            OmniClientChat.displayChatMessage(
                "§cCouldn't understand '$state'.§f Toggle the mod with §6/levelhead mod <on|off>§f. Current state: ${formatToggle(MasterConfig.enabled)}§f."
            )
            return
        }
        setEnabled(toggle)
    }

    @Command(value = ["gui"])
    fun gui() {
        UIManager.openConfigMenu("bedwars_levelhead")
    }

    @Command(value = ["status"])
    fun status() {
        val snapshot = Levelhead.statusSnapshot()
        val proxyStatus = when {
            !snapshot.proxyEnabled -> "§7disabled"
            snapshot.proxyConfigured -> "§aconfigured"
            else -> "§cmissing config"
        }
        val lastAttempt = formatAge(snapshot.lastAttemptAgeMillis)
        val lastSuccess = formatAge(snapshot.lastSuccessAgeMillis)
        val rateReset = formatAge(snapshot.rateLimitResetMillis)
        val serverCooldown = snapshot.serverCooldownMillis?.let { formatAge(it) }

        sendStatus("§aStatus snapshot:")
        sendStatus("§fProxy: $proxyStatus")
        sendStatus("§fCache size: §6${snapshot.cacheSize}")
        sendStatus(
            "§fStar cache TTL: §6${snapshot.starCacheTtlMinutes}m" +
                "§f (cold misses: §6${snapshot.cacheMissesCold}§f," +
                " expired refreshes: §6${snapshot.cacheMissesExpired}§f)"
        )
        sendStatus("§fLast request: §6$lastAttempt§f ago")
        sendStatus("§fLast success: §6$lastSuccess§f ago")
        sendStatus(
            "§fRate limit: §6${snapshot.rateLimitRemaining}§f remaining, resets in §6$rateReset"
        )
        serverCooldown?.let {
            sendStatus("§fServer cooldown hint: §6$it§f remaining")
        }
    }

    @Command(value = ["cachettl"])
    fun cacheTtl(minutesInput: String) {
        val sanitized = minutesInput.trim()
        val parsed = sanitized.toIntOrNull()
        if (parsed == null) {
            val current = LevelheadConfig.starCacheTtlMinutesValue
            OmniClientChat.displayChatMessage(
                "§cCouldn't read '$minutesInput'.§f Choose a number of minutes between §6${LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES}§f and §6${LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES}§f. Current TTL: §6$current§f."
            )
            return
        }

        val clamped = parsed.coerceIn(LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES, LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES)
        LevelheadConfig.setStarCacheTtlMinutes(clamped)
        Levelhead.clearCachedStars()
        OmniClientChat.displayChatMessage("§aUpdated BedWars star cache TTL to §6${clamped} minutes§a.")
    }

    @Command(value = ["debug"])
    fun debug() {
        val context = BedwarsModeDetector.currentContext()
        val snapshot = Levelhead.statusSnapshot()
        val displayCache = Levelhead.displayManager.aboveHead.sumOf { it.cache.size }
        OmniClientChat.displayChatMessage("§aDebug info:")
        OmniClientChat.displayChatMessage("§fContext: §6${context.name.lowercase(Locale.ROOT)}")
        OmniClientChat.displayChatMessage("§fMod enabled: ${formatToggle(MasterConfig.enabled)}§f, show self: ${formatToggle(Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true)}")
        OmniClientChat.displayChatMessage("§fStar cache entries: §6${snapshot.cacheSize}§f, display cache entries: §6$displayCache")
        OmniClientChat.displayChatMessage("§fRate limiter remaining: §6${snapshot.rateLimitRemaining}§f, proxy: ${if (snapshot.proxyEnabled) "§aenabled" else "§7disabled"}§f")
    }

    private fun setEnabled(enabled: Boolean) {
        if (MasterConfig.enabled == enabled) {
            val stateText = if (enabled) "enabled" else "disabled"
            val color = if (enabled) "§a" else "§c"
            OmniClientChat.displayChatMessage("§fBedWars Levelhead is already ${color}$stateText§f.")
            return
        }
        MasterConfig.enabled = enabled
        if (!enabled) {
            Levelhead.displayManager.clearAll()
        }
        val stateText = if (enabled) "enabled" else "disabled"
        val color = if (enabled) "§a" else "§c"
        OmniClientChat.displayChatMessage("${color}BedWars Levelhead §fhas been ${color}$stateText§f.")
    }

    private fun resetBedwarsFetcher() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCachesWithoutRefetch()
        BedwarsFetcher.clearCache()
        BedwarsFetcher.resetWarnings()
    }

    private fun sendStatus(message: String) {
        OmniClientChat.displayChatMessage("[Levelhead] $message")
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

    private fun formatToggle(value: Boolean): String {
        return if (value) "§aon" else "§coff"
    }

    private fun parseToggle(value: String): Boolean? {
        return when (value.lowercase(Locale.ROOT)) {
            "on", "enable", "enabled", "true", "yes", "1" -> true
            "off", "disable", "disabled", "false", "no", "0" -> false
            else -> null
        }
    }

    // Register the command
    fun register() {
        CommandManager.register(this)
    }
}

