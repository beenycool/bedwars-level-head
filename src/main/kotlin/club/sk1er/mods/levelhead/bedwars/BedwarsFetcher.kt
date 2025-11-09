package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.dashUUID
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.util.ChatComponentText
import okhttp3.HttpUrl
import okhttp3.Request
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.text.RegexOption

object BedwarsFetcher {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"

    enum class ChatColor(val code: String) {
        RED("§c"),
        YELLOW("§e"),
        GOLD("§6"),
        GREEN("§a"),
        GRAY("§7");

        override fun toString(): String = code
    }

    private val missingKeyWarned = AtomicBoolean(false)
    private val invalidKeyWarned = AtomicBoolean(false)
    private val invalidProxyTokenWarned = AtomicBoolean(false)
    private val networkIssueWarned = AtomicBoolean(false)
    private val proxyMisconfiguredWarned = AtomicBoolean(false)

    private data class CacheEntry(
        var star: Int?,
        var fetchedAt: Long,
        var lastModified: Long?
    )

    private val cache = java.util.concurrent.ConcurrentHashMap<String, CacheEntry>()
    @Volatile private var lastAttemptAt: Long? = null
    @Volatile private var lastSuccessAt: Long? = null
    private val coldMisses = AtomicInteger(0)
    private val expiredMisses = AtomicInteger(0)

    sealed class FetchResult {
        data class Success(val payload: JsonObject, val lastModified: Long? = null) : FetchResult()
        object NotModified : FetchResult()
        data class TemporaryError(val reason: String? = null) : FetchResult()
        data class PermanentError(val reason: String? = null) : FetchResult()
    }

    fun fetchPlayer(uuid: UUID, lastFetchedAt: Long?): FetchResult {
        if (shouldUseProxy()) {
            val identifier = uuid.toString().replace("-", "")
            return fetchProxy(identifier, lastFetchedAt)
        }

        val hypixelResult = fetchFromHypixel(uuid)
        return hypixelResult
    }

    fun fetchProxyPlayer(identifier: String, lastFetchedAt: Long? = null): FetchResult {
        if (!shouldUseProxy()) {
            return FetchResult.PermanentError("PROXY_DISABLED")
        }
        return fetchProxy(identifier, lastFetchedAt)
    }

    fun getStar(identifierInput: String): Int? {
        val identifier = identifierInput.trim()
        if (identifier.isEmpty()) return null

        val normalized = identifier.lowercase(Locale.ROOT)
        val now = System.currentTimeMillis()
        val entry = cache[normalized]
        val ttlMillis = LevelheadConfig.starCacheTtl.toMillis()
        if (entry != null && now - entry.fetchedAt <= ttlMillis && entry.star != null) {
            return entry.star
        }

        if (entry == null) {
            coldMisses.incrementAndGet()
        } else {
            expiredMisses.incrementAndGet()
        }

        val result = if (shouldUseProxy()) {
            fetchProxyPlayer(normalized, entry?.lastModified)
        } else {
            val uuid = dashUUID(identifier)?.let { UUID.fromString(it) }
            if (uuid != null) fetchPlayer(uuid, entry?.lastModified) else FetchResult.PermanentError("INVALID_IDENTIFIER")
        }

        lastAttemptAt = now

        return when (result) {
            is FetchResult.Success -> {
                val experience = parseBedwarsExperience(result.payload)
                val star = experience?.let { BedwarsStar.calculateStar(it) }
                cache[normalized] = CacheEntry(star, now, result.lastModified)
                lastSuccessAt = System.currentTimeMillis()
                star
            }
            FetchResult.NotModified -> {
                entry?.let {
                    it.fetchedAt = now
                    lastSuccessAt = System.currentTimeMillis()
                    it.star
                }
            }
            is FetchResult.PermanentError -> {
                entry?.star
            }
            is FetchResult.TemporaryError -> {
                entry?.star
            }
        }
    }

    fun clearCache() {
        cache.clear()
        coldMisses.set(0)
        expiredMisses.set(0)
    }

    fun cacheSize(): Int = cache.size

    fun cacheMissesCold(): Int = coldMisses.get()

    fun cacheMissesExpired(): Int = expiredMisses.get()

    fun lastAttemptAgeMillis(): Long? = lastAttemptAt?.let { System.currentTimeMillis() - it }

    fun lastSuccessAgeMillis(): Long? = lastSuccessAt?.let { System.currentTimeMillis() - it }

    private fun shouldUseProxy(): Boolean {
        if (!LevelheadConfig.proxyEnabled) {
            proxyMisconfiguredWarned.set(false)
            return false
        }

        val baseConfigured = LevelheadConfig.proxyBaseUrl.isNotBlank()
        if (!baseConfigured) {
            if (proxyMisconfiguredWarned.compareAndSet(false, true)) {
                sendMessage(
                    "${ChatColor.RED}Proxy enabled but missing base URL. ${ChatColor.YELLOW}Set the proxy base URL in Levelhead settings."
                )
            }
            return false
        }

        proxyMisconfiguredWarned.set(false)
        return true
    }

    private fun fetchProxy(identifierInput: String, lastFetchedAt: Long?): FetchResult {
        val baseUrl = LevelheadConfig.proxyBaseUrl.trim()
        val identifier = sanitizeProxyIdentifier(identifierInput)
        val isPublic = LevelheadConfig.proxyAuthToken.isBlank()
        val url = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.apply { if (isPublic) addPathSegment("public") }
            ?.addPathSegment("player")
            ?.addPathSegment(identifier)
            ?.build()

        if (url == null) {
            Levelhead.logger.error(
                "Failed to build proxy BedWars endpoint URL from base '{}'",
                LevelheadConfig.proxyBaseUrl.sanitizeForLogs()
            )
            return FetchResult.PermanentError("INVALID_PROXY_URL")
        }

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .header("X-Levelhead-Install", LevelheadConfig.installId)
            .apply {
                LevelheadConfig.proxyAuthToken.takeIf { it.isNotBlank() }?.let { token ->
                    header("Authorization", "Bearer $token")
                }
                lastFetchedAt?.let { since ->
                    header("If-Modified-Since", since.toHttpDateString())
                }
            }
            .get()
            .build()

        return try {
            Levelhead.okHttpClient.newCall(request).execute().use { response ->
                if (response.code() == 304) {
                    networkIssueWarned.set(false)
                    invalidProxyTokenWarned.set(false)
                    return FetchResult.NotModified
                }

                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))
                val lastModifiedMillis = parseHttpDateMillis(response.header("Last-Modified"))
                val body = response.body()?.string().orEmpty()

                if (!response.isSuccessful) {
                    return when (response.code()) {
                        401, 403 -> {
                            notifyInvalidProxyToken(response.code(), body)
                            FetchResult.PermanentError("PROXY_AUTH")
                        }
                        429 -> {
                            handleRetryAfterHint("proxy", retryAfterMillis)
                            Levelhead.logger.warn(
                                "Proxy rate limited BedWars requests. Retry after {} ms.",
                                retryAfterMillis ?: -1
                            )
                            FetchResult.TemporaryError("PROXY_RATE_LIMIT")
                        }

                        else -> {
                            handleRetryAfterHint("proxy", retryAfterMillis)
                            Levelhead.logger.error(
                                "Proxy request failed with status {}: {}",
                                response.code(),
                                body.sanitizeForLogs().take(200)
                            )
                            FetchResult.TemporaryError("HTTP_${response.code()}")
                        }
                    }
                }

                invalidProxyTokenWarned.set(false)

                val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse proxy response body", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }

                if (json.get("success")?.asBoolean == false) {
                    Levelhead.logger.warn("Proxy response reported success=false: {}", body.sanitizeForLogs().take(200))
                    return FetchResult.TemporaryError("PROXY_ERROR")
                }

                networkIssueWarned.set(false)
                handleRetryAfterHint("proxy", retryAfterMillis)
                FetchResult.Success(json, lastModifiedMillis)
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy BedWars data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    private fun fetchFromHypixel(uuid: UUID): FetchResult {
        val key = LevelheadConfig.apiKey
        if (key.isBlank()) {
            notifyMissingKey()
            return FetchResult.PermanentError("MISSING_KEY")
        }

        val url = HttpUrl.parse(HYPIXEL_PLAYER_ENDPOINT)?.newBuilder()
            ?.addQueryParameter("key", key)
            ?.addQueryParameter("uuid", uuid.toString().replace("-", ""))
            ?.build()

        if (url == null) {
            Levelhead.logger.error("Failed to build Hypixel BedWars endpoint URL")
            return FetchResult.PermanentError("INVALID_URL")
        }

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .get()
            .build()

        return try {
            Levelhead.okHttpClient.newCall(request).execute().use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))

                if (!response.isSuccessful) {
                    val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrNull()
                    if (response.code() == 403 && json != null) {
                        val cause = json.get("cause")?.asString ?: "Unknown"
                        notifyInvalidKey(cause.sanitizeForLogs())
                        return FetchResult.PermanentError("INVALID_KEY")
                    }
                    invalidKeyWarned.set(false)
                    networkIssueWarned.set(false)
                    if (response.code() == 429) {
                        handleRetryAfterHint("hypixel", retryAfterMillis)
                        Levelhead.logger.warn(
                            "Hypixel rate limited BedWars requests. Retry after {} ms.",
                            retryAfterMillis ?: -1
                        )
                    }
                    return FetchResult.TemporaryError("HYPIXEL_${response.code()}")
                }

                invalidKeyWarned.set(false)
                networkIssueWarned.set(false)
                val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse Hypixel response", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }
                handleRetryAfterHint("hypixel", retryAfterMillis)
                FetchResult.Success(json, null)
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch Hypixel BedWars data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    fun resetWarnings() {
        missingKeyWarned.set(false)
        invalidKeyWarned.set(false)
        invalidProxyTokenWarned.set(false)
        networkIssueWarned.set(false)
        proxyMisconfiguredWarned.set(false)
    }

    fun parseBedwarsExperience(json: JsonObject): Long? {
        json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { parseExperienceFromBedwars(it) }
            ?.let { return it }

        json.get("bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { parseExperienceFromBedwars(it) }
            ?.let { return it }

        val playerContainer = when {
            json.get("player")?.isJsonObject == true -> json.getAsJsonObject("player")
            json.get("stats")?.isJsonObject == true -> json
            else -> null
        } ?: return null

        val stats = playerContainer.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        val bedwars = stats.get("Bedwars")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null

        return parseExperienceFromBedwars(bedwars)
    }

    private fun parseExperienceFromBedwars(bedwars: JsonObject): Long? {
        return bedwars.entrySet()
            .firstOrNull { (key, _) ->
                key.equals("Experience", ignoreCase = true) || key.equals("bedwars_experience", ignoreCase = true)
            }
            ?.value
            ?.takeIf { !it.isJsonNull }
            ?.let { kotlin.runCatching { it.asLong }.getOrNull() }
    }

    private fun notifyMissingKey() {
        if (missingKeyWarned.compareAndSet(false, true)) {
            sendMessage(
                "${ChatColor.YELLOW}Set your Hypixel API key with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to enable BedWars stats."
            )
        }
    }

    private fun sanitizeProxyIdentifier(identifier: String): String {
        val trimmed = identifier.trim()
        if (trimmed.isEmpty()) {
            return trimmed
        }
        val collapsed = trimmed.replace("-", "")
        return if (collapsed.matches(Regex("^[0-9a-f]{32}$", RegexOption.IGNORE_CASE))) {
            collapsed.lowercase(Locale.ROOT)
        } else {
            trimmed
        }
    }

    private fun notifyInvalidKey(cause: String) {
        if (cause.contains("api key", ignoreCase = true)) {
            if (invalidKeyWarned.compareAndSet(false, true)) {
                sendMessage(
                    "${ChatColor.RED}Hypixel rejected your API key (${cause.trim()}). ${ChatColor.YELLOW}Update it with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW}."
                )
            }
        } else {
            Levelhead.logger.warn("Hypixel API returned error: {}", cause.sanitizeForLogs())
        }
    }

    private fun notifyInvalidProxyToken(status: Int, body: String) {
        if (invalidProxyTokenWarned.compareAndSet(false, true)) {
            sendMessage("${ChatColor.RED}Proxy authentication failed. ${ChatColor.YELLOW}Update your proxy token in Levelhead settings.")
        }
        Levelhead.logger.warn(
            "Proxy authentication failed with status {}: {}",
            status,
            body.sanitizeForLogs().take(200)
        )
    }

    private fun String.sanitizeForLogs(): String {
        if (isEmpty()) return this
        var sanitized = this
        listOf(LevelheadConfig.apiKey, LevelheadConfig.proxyAuthToken, LevelheadConfig.installId)
            .filter { it.isNotBlank() }
            .forEach { secret ->
                sanitized = sanitized.replace(secret, "***")
            }
        sanitized = sanitized.replace(Regex("""(?i)(key|token)=([^&\s]+)""")) { matchResult ->
            "${matchResult.groupValues[1]}=***"
        }
        sanitized = sanitized.replace(Regex("""(?i)"(key|token|api_key|apikey)"\s*:\s*"([^"]+)""")) { matchResult ->
            "\"${matchResult.groupValues[1]}\":\"***\""
        }
        sanitized = sanitized.replace(Regex("""(?i)(authorization\s*:\s*bearer\s+)([^\s"]+)""")) { matchResult ->
            "${matchResult.groupValues[1]}***"
        }
        return sanitized
    }

    private fun notifyNetworkIssue(ex: IOException) {
        if (networkIssueWarned.compareAndSet(false, true)) {
            sendMessage("${ChatColor.RED}Stats offline (proxy/hypixel). ${ChatColor.YELLOW}Retrying in 60s.")
        }
        Levelhead.logger.error("Network error while fetching BedWars data", ex)
    }

    private fun sendMessage(message: String) {
        Minecraft.getMinecraft().addScheduledTask {
            val player = Minecraft.getMinecraft().thePlayer ?: return@addScheduledTask
            player.addChatMessage(ChatComponentText(message))
        }
    }

    private fun handleRetryAfterHint(source: String, retryAfterMillis: Long?) {
        val millis = retryAfterMillis ?: return
        if (millis <= 0) return
        Levelhead.logger.info("Received Retry-After hint from {} for {} ms", source, millis)
        Levelhead.rateLimiter.registerServerCooldown(Duration.ofMillis(millis))
    }

    private fun parseRetryAfterMillis(value: String?): Long? {
        val raw = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        raw.toLongOrNull()?.let { seconds ->
            return if (seconds < 0) null else seconds * 1000L
        }
        raw.toDoubleOrNull()?.let { seconds ->
            return if (seconds < 0) null else (seconds * 1000.0).toLong()
        }

        return kotlin.runCatching {
            val targetInstant = ZonedDateTime.parse(raw, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
            val now = Instant.now()
            val millis = Duration.between(now, targetInstant).toMillis()
            if (millis <= 0) null else millis
        }.getOrNull()
    }

    private fun parseHttpDateMillis(value: String?): Long? {
        val raw = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return kotlin.runCatching {
            ZonedDateTime.parse(raw, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
        }.getOrNull()
    }

    private fun Long.toHttpDateString(): String {
        return DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(this))
    }
}
