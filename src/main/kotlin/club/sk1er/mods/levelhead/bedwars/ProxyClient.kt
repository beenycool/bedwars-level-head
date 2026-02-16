package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.executeWithRetries
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.handleRetryAfterHint
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.parseRetryAfterMillis
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.toHttpDateString
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import net.minecraft.util.EnumChatFormatting as ChatColor
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.nio.charset.StandardCharsets
import kotlin.text.RegexOption

object ProxyClient {
    private val invalidProxyTokenWarned = AtomicBoolean(false)
    private val networkIssueWarned = AtomicBoolean(false)
    private val proxyMisconfiguredWarned = AtomicBoolean(false)

    fun isAvailable(): Boolean {
        if (!LevelheadConfig.proxyEnabled) return false

        if (!LevelheadConfig.communityDatabase) {
            proxyMisconfiguredWarned.set(false)
            return false
        }

        val baseConfigured = LevelheadConfig.proxyBaseUrl.isNotBlank()
        if (!baseConfigured) {
            // Suppress warnings when user has API key set and using shared backend
            if (!LevelheadConfig.shouldSuppressBackendWarnings()) {
                if (proxyMisconfiguredWarned.compareAndSet(false, true)) {
                    Levelhead.sendChat(
                        "${ChatColor.RED}Community Database enabled but missing proxy URL. ${ChatColor.YELLOW}Set the proxy base URL in Levelhead settings."
                    )
                }
            }
            return false
        }

        proxyMisconfiguredWarned.set(false)
        return true
    }

    fun canContribute(): Boolean {
        return LevelheadConfig.communityDatabase && LevelheadConfig.apiKey.isNotBlank() && LevelheadConfig.proxyBaseUrl.isNotBlank()
    }

    suspend fun fetchPlayer(identifierInput: String, lastFetchedAt: Long?, etag: String? = null): FetchResult {
        val baseUrl = LevelheadConfig.resolveDbUrl()
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
                // Prefer ETag over If-Modified-Since when available
                etag?.takeIf { it.isNotBlank() }?.let { tag ->
                    header("If-None-Match", tag)
                } ?: lastFetchedAt?.let { since ->
                    header("If-Modified-Since", since.toHttpDateString())
                }
            }
            .get()
            .build()

        DebugLogging.logRequestDebug {
            "[LevelheadDebug][network] proxy request: ${url.toString().sanitizeForLogs()}"
        }

        return try {
            executeWithRetries(request, "proxy player").use { response ->
                if (response.code() == 304) {
                    networkIssueWarned.set(false)
                    invalidProxyTokenWarned.set(false)
                    val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))
                    handleRetryAfterHint("proxy", retryAfterMillis, silent = true)
                    DebugLogging.logRequestDebug {
                        val etagVal = response.header("ETag")
                        val cacheVal = response.header("X-Cache") ?: "<absent>"
                        "[LevelheadDebug][network] proxy 304 Not Modified etag=$etagVal cache=$cacheVal"
                    }
                    return FetchResult.NotModified
                }

                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))
                val cacheHeader = response.header("X-Cache")
                val isCacheHit = cacheHeader?.equals("HIT", ignoreCase = true) == true ||
                        cacheHeader?.equals("PARTIAL", ignoreCase = true) == true
                val body = response.body()?.string().orEmpty()

                DebugLogging.logRequestDebug {
                    val etagVal = response.header("ETag")
                    val cacheVal = cacheHeader ?: "<absent>"
                    val hasEtag = etagVal != null
                    "[LevelheadDebug][network] proxy response status=${response.code()} etagPresent=$hasEtag etagValue=$etagVal cache=$cacheVal bodyLen=${body.length}"
                }

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
                                "Proxy request failed with status {} (bodyLen={})",
                                response.code(),
                                body.length
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
                    Levelhead.logger.warn("Proxy response reported success=false (bodyLen={})", body.length)
                    return FetchResult.TemporaryError("PROXY_ERROR")
                }

                networkIssueWarned.set(false)
                handleRetryAfterHint("proxy", retryAfterMillis, silent = isCacheHit)
                val newEtag = response.header("ETag")
                FetchResult.Success(json, newEtag)
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy BedWars data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    suspend fun fetchBatch(uuids: List<UUID>): Map<UUID, FetchResult> {
        if (uuids.isEmpty()) return emptyMap()
        
        // In offline mode, return empty results
        if (LevelheadConfig.backendMode == club.sk1er.mods.levelhead.core.BackendMode.OFFLINE) {
            return uuids.associateWith { FetchResult.PermanentError("OFFLINE_MODE") }
        }

        // We assume ensureConfigured() or similar was checked by caller or we check here.
        // Since isAvailable handles warnings, we should use it.
        if (!isAvailable()) return emptyMap()

        val identifierToUuid = uuids.associateBy { it.toString().replace("-", "").lowercase(Locale.ROOT) }

        val payload = JsonObject().apply {
            val uuidArray = JsonArray()
            identifierToUuid.keys.forEach { identifier ->
                uuidArray.add(JsonPrimitive(identifier))
            }
            add("uuids", uuidArray)
        }

        val url = HttpUrl.parse(LevelheadConfig.resolveDbUrl())
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

        DebugLogging.logRequestDebug {
            "[LevelheadDebug][network] proxy batch request: ${url.toString().sanitizeForLogs()} count=${uuids.size}"
        }

        return try {
            executeWithRetries(request, "proxy batch").use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))
                val cacheHeader = response.header("X-Cache")
                val isCacheHit = cacheHeader?.equals("HIT", ignoreCase = true) == true ||
                        cacheHeader?.equals("PARTIAL", ignoreCase = true) == true

                DebugLogging.logRequestDebug {
                    val etag = response.header("ETag")
                    val cacheDisplay = cacheHeader ?: "<absent>"
                    val hasEtag = etag != null
                    "[LevelheadDebug][network] proxy batch response status=${response.code()} etagPresent=$hasEtag cache=$cacheDisplay bodyLen=${body.length}"
                }

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
                                "Proxy batch request failed with status {} (bodyLen={})",
                                response.code(),
                                body.length
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
                    Levelhead.logger.warn("Proxy batch response reported success=false (bodyLen={})", body.length)
                    return identifierToUuid.values.associateWith { FetchResult.TemporaryError("PROXY_ERROR") }
                }

                val data = json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
                if (data == null) {
                    Levelhead.logger.warn("Proxy batch response missing data object (bodyLen={})", body.length)
                    return identifierToUuid.values.associateWith { FetchResult.TemporaryError("MISSING_DATA") }
                }

                networkIssueWarned.set(false)
                handleRetryAfterHint("proxy", retryAfterMillis, silent = isCacheHit)

                val results = mutableMapOf<UUID, FetchResult>()
                identifierToUuid.forEach { (identifier, uuid) ->
                    val payloadElement = data.get(identifier)
                    if (payloadElement != null && payloadElement.isJsonObject) {
                        results[uuid] = FetchResult.Success(payloadElement.asJsonObject)
                    } else {
                        results[uuid] = FetchResult.TemporaryError("NOT_FOUND")
                    }
                }

                DebugLogging.logRequestDebug {
                    val successCount = results.values.count { it is FetchResult.Success }
                    "[LevelheadDebug][network] proxy batch processed chunkSize=${uuids.size} resultsReturned=${results.size} successCount=$successCount"
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

    suspend fun submitPlayer(uuid: UUID, data: JsonObject) {
        if (!canContribute()) return
        val normalizedUuid = uuid.toString().replace("-", "").lowercase(Locale.ROOT)
        val baseUrl = LevelheadConfig.resolveDbUrl()
        val url = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.addPathSegment("player")
            ?.addPathSegment("submit")
            ?.build()

        if (url == null) {
            Levelhead.logger.warn("Failed to build submit URL from base '{}'", baseUrl.sanitizeForLogs())
            return
        }

        val payload = JsonObject().apply {
            addProperty("uuid", normalizedUuid)
            add("data", data)
            maybeSignSubmission(normalizedUuid, data)?.let { signature ->
                addProperty("signature", signature)
            }
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

        try {
            Levelhead.okHttpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    Levelhead.logger.info("Contributed player data for {} to community database", uuid)
                } else {
                    val responseBodyLen = response.body()?.string()?.length ?: 0
                    Levelhead.logger.warn(
                        "Failed to contribute player data: {} (bodyLen={})",
                        response.code(),
                        responseBodyLen
                    )
                }
            }
        } catch (ex: IOException) {
            Levelhead.logger.warn("Network error contributing player data: {}", ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Error contributing player data", ex)
        }
    }

    fun resetWarnings() {
        invalidProxyTokenWarned.set(false)
        networkIssueWarned.set(false)
        proxyMisconfiguredWarned.set(false)
    }

    private fun notifyInvalidProxyToken(status: Int, body: String) {
        if (invalidProxyTokenWarned.compareAndSet(false, true)) {
            Levelhead.sendChat("${ChatColor.RED}Proxy authentication failed. ${ChatColor.YELLOW}Update your proxy token in Levelhead settings.")
        }
        Levelhead.logger.warn(
            "Proxy authentication failed with status {} (bodyLen={})",
            status,
            body.length
        )
    }

    private fun notifyNetworkIssue(ex: IOException) {
        if (networkIssueWarned.compareAndSet(false, true)) {
            Levelhead.sendChat("${ChatColor.RED}Proxy stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
        }
        Levelhead.logger.error("Network error while fetching proxy BedWars data", ex)
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

    private fun maybeSignSubmission(uuid: String, data: JsonObject): String? {
        val secret = LevelheadConfig.communitySubmitSecret.trim()
        if (secret.isEmpty()) {
            return null
        }
        return try {
            val canonical = canonicalize(data)
            hmacSha256Hex(secret, "$uuid:$canonical")
        } catch (ex: Exception) {
            Levelhead.logger.warn("Failed to sign submission payload", ex)
            null
        }
    }

    private fun hmacSha256Hex(secret: String, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        val bytes = mac.doFinal(message.toByteArray(StandardCharsets.UTF_8))
        val hexChars = CharArray(bytes.size * 2)
        val hexArray = "0123456789abcdef".toCharArray()
        for (i in bytes.indices) {
            val v = bytes[i].toInt() and 0xFF
            hexChars[i * 2] = hexArray[v ushr 4]
            hexChars[i * 2 + 1] = hexArray[v and 0x0F]
        }
        return String(hexChars)
    }

    private fun canonicalize(element: com.google.gson.JsonElement?): String {
        if (element == null || element.isJsonNull) {
            return "null"
        }

        if (element.isJsonArray) {
            val array = element.asJsonArray
            return buildString {
                append('[')
                array.map { canonicalize(it) }.joinTo(this, separator = ",")
                append(']')
            }
        }

        if (element.isJsonObject) {
            val obj = element.asJsonObject
            val entries = obj.entrySet().sortedBy { it.key }
            return buildString {
                append('{')
                entries.joinTo(this, separator = ",") { entry ->
                    val keyJson = JsonPrimitive(entry.key).toString()
                    "$keyJson:${canonicalize(entry.value)}"
                }
                append('}')
            }
        }

        return element.toString()
    }
}
