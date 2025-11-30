package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.text.RegexOption
import net.minecraft.util.EnumChatFormatting as ChatColor

object BedwarsFetcher {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"

    private val missingKeyWarned = AtomicBoolean(false)
    private val invalidKeyWarned = AtomicBoolean(false)
    private val invalidProxyTokenWarned = AtomicBoolean(false)
    private val networkIssueWarned = AtomicBoolean(false)
    private val proxyMisconfiguredWarned = AtomicBoolean(false)

    sealed class FetchResult {
        data class Success(val payload: JsonObject) : FetchResult()
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

    fun fetchBatchFromProxy(uuids: List<UUID>): Map<UUID, FetchResult> {
        if (!shouldUseProxy()) return emptyMap()
        if (uuids.isEmpty()) return emptyMap()

        val identifierToUuid = uuids.associateBy { it.toString().replace("-", "").lowercase(Locale.ROOT) }

        val payload = JsonObject().apply {
            val uuidArray = JsonArray()
            identifierToUuid.keys.forEach { identifier ->
                uuidArray.add(JsonPrimitive(identifier))
            }
            add("uuids", uuidArray)
        }

        val url = HttpUrl.parse(LevelheadConfig.proxyBaseUrl.trim())
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.addPathSegment("player")
            ?.addPathSegment("batch")
            ?.build()

        if (url == null) {
            Levelhead.logger.error(
                "Failed to build proxy BedWars batch endpoint URL from base '{}'",
                LevelheadConfig.proxyBaseUrl.sanitizeForLogs()
            )
            return identifierToUuid.values.associateWith { FetchResult.PermanentError("INVALID_PROXY_URL") }
        }

        val request = Request.Builder()
            .url(url)
            .post(RequestBody.create(MediaType.parse("application/json"), payload.toString()))
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .header("X-Levelhead-Install", LevelheadConfig.installId)
            .apply {
                LevelheadConfig.proxyAuthToken.takeIf { it.isNotBlank() }?.let { token ->
                    header("Authorization", "Bearer $token")
                }
            }
            .build()

        return try {
            executeWithRetries(request, "proxy batch").use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))

                if (!response.isSuccessful) {
                    return when (response.code()) {
                        401, 403 -> {
                            notifyInvalidProxyToken(response.code(), body)
                            identifierToUuid.values.associateWith { FetchResult.PermanentError("PROXY_AUTH") }
                        }

                        429 -> {
                            handleRetryAfterHint("proxy", retryAfterMillis)
                            Levelhead.logger.warn(
                                "Proxy rate limited BedWars batch requests. Retry after {} ms.",
                                retryAfterMillis ?: -1
                            )
                            identifierToUuid.values.associateWith { FetchResult.TemporaryError("PROXY_RATE_LIMIT") }
                        }

                        else -> {
                            handleRetryAfterHint("proxy", retryAfterMillis)
                            Levelhead.logger.error(
                                "Proxy batch request failed with status {}: {}",
                                response.code(),
                                body.sanitizeForLogs().take(200)
                            )
                            identifierToUuid.values.associateWith { FetchResult.TemporaryError("HTTP_${response.code()}") }
                        }
                    }
                }

                invalidProxyTokenWarned.set(false)

                val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse proxy batch response body", it)
                    return identifierToUuid.values.associateWith { FetchResult.TemporaryError("PARSE_ERROR") }
                }

                if (json.get("success")?.asBoolean == false) {
                    Levelhead.logger.warn("Proxy batch response reported success=false: {}", body.sanitizeForLogs().take(200))
                    return identifierToUuid.values.associateWith { FetchResult.TemporaryError("PROXY_ERROR") }
                }

                val data = json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
                if (data == null) {
                    Levelhead.logger.warn("Proxy batch response missing data object: {}", body.sanitizeForLogs().take(200))
                    return identifierToUuid.values.associateWith { FetchResult.TemporaryError("MISSING_DATA") }
                }

                networkIssueWarned.set(false)
                handleRetryAfterHint("proxy", retryAfterMillis)

                val results = mutableMapOf<UUID, FetchResult>()
                identifierToUuid.forEach { (identifier, uuid) ->
                    val payloadElement = data.get(identifier)
                    if (payloadElement != null && payloadElement.isJsonObject) {
                        results[uuid] = FetchResult.Success(payloadElement.asJsonObject)
                    } else {
                        results[uuid] = FetchResult.TemporaryError("NOT_FOUND")
                    }
                }
                results
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            identifierToUuid.values.associateWith { FetchResult.TemporaryError(ex.message) }
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy BedWars batch data", ex)
            identifierToUuid.values.associateWith { FetchResult.TemporaryError(ex.message) }
        }
    }

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
            executeWithRetries(request, "proxy player").use { response ->
                if (response.code() == 304) {
                    networkIssueWarned.set(false)
                    invalidProxyTokenWarned.set(false)
                    return FetchResult.NotModified
                }

                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))
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
                FetchResult.Success(json)
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
            .header("API-Key", key)
            .get()
            .build()

        return try {
            executeWithRetries(request, "Hypixel player").use { response ->
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
                FetchResult.Success(json)
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch Hypixel BedWars data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    private fun executeWithRetries(request: Request, description: String, attempts: Int = 2): okhttp3.Response {
        var lastException: IOException? = null
        repeat(attempts) { index ->
            try {
                return Levelhead.okHttpClient.newCall(request).execute()
            } catch (ex: IOException) {
                if (!isTimeout(ex)) {
                    throw ex
                }
                lastException = ex
                val remainingAttempts = attempts - index - 1
                if (remainingAttempts > 0) {
                    val backoffMillis = 250L * (index + 1)
                    Levelhead.logger.warn(
                        "Timed out {} request (attempt {}/{}). Retrying in {} ms.",
                        description,
                        index + 1,
                        attempts,
                        backoffMillis
                    )
                    Thread.sleep(backoffMillis)
                }
            }
        }
        throw lastException ?: IOException("Request failed for $description")
    }

    private fun isTimeout(error: IOException): Boolean {
        if (error is SocketTimeoutException) return true
        return error is InterruptedIOException && error.message?.contains("timeout", ignoreCase = true) == true
    }

    fun resetWarnings() {
        missingKeyWarned.set(false)
        invalidKeyWarned.set(false)
        invalidProxyTokenWarned.set(false)
        networkIssueWarned.set(false)
        proxyMisconfiguredWarned.set(false)
    }

    fun parseBedwarsExperience(json: JsonObject): Long? {
        val bedwars = findBedwarsStats(json) ?: return null
        return parseExperienceFromBedwars(bedwars)
    }

    fun parseBedwarsFkdr(json: JsonObject): Double? {
        val bedwars = findBedwarsStats(json) ?: return null
        val fkdrElement = bedwars.get("fkdr")
        if (fkdrElement != null && !fkdrElement.isJsonNull) {
            return kotlin.runCatching { fkdrElement.asDouble }.getOrNull()
        }

        val finalKills = bedwars.numberValue("final_kills_bedwars") ?: 0.0
        val finalDeaths = bedwars.numberValue("final_deaths_bedwars") ?: 0.0
        if (finalKills == 0.0 && finalDeaths == 0.0) {
            return null
        }
        return if (finalDeaths <= 0) finalKills else finalKills / finalDeaths
    }

    fun parseBedwarsWinstreak(json: JsonObject): Int? {
        val bedwars = findBedwarsStats(json) ?: return null
        val element = bedwars.get("winstreak") ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asInt }.getOrNull()
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

    private fun findBedwarsStats(json: JsonObject): JsonObject? {
        json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        json.get("bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        val playerContainer = when {
            json.get("player")?.isJsonObject == true -> json.getAsJsonObject("player")
            json.get("stats")?.isJsonObject == true -> json
            else -> null
        } ?: return null

        val stats = playerContainer.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        return stats.get("Bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
    }

    private fun JsonObject.numberValue(key: String): Double? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asDouble }.getOrNull()
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
        Levelhead.sendChat(message)
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

    private fun Long.toHttpDateString(): String {
        return DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(this))
    }
}
