package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.executeWithRetries
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.handleRetryAfterHint
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.parseRetryAfterMillis
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.await
import club.sk1er.mods.levelhead.core.DebugLogging
import com.google.gson.JsonArray
import com.google.gson.JsonParser
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import net.minecraft.util.EnumChatFormatting as ChatColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object ProxyClient {
    private val invalidProxyTokenWarned = AtomicBoolean(false)
    private val networkIssueWarned = AtomicBoolean(false)
    private val proxyMisconfiguredWarned = AtomicBoolean(false)

    private val shortTimeoutClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .writeTimeout(2, TimeUnit.SECONDS)
            .callTimeout(3, TimeUnit.SECONDS)
            .build()
    }

    fun isAvailable(): Boolean {
        if (!isConfigured()) {
            if (proxyMisconfiguredWarned.compareAndSet(false, true)) {
                Levelhead.sendChat(
                    "${ChatColor.RED}Stats backend is not configured. ${ChatColor.YELLOW}Set the backend URL in Levelhead settings."
                )
            }
            return false
        }

        proxyMisconfiguredWarned.set(false)
        return true
    }

    /**
     * Cheap configuration check (no warnings) shared with [club.sk1er.mods.levelhead.core.BaseStatsFetcher].
     */
    fun isConfigured(): Boolean {
        return LevelheadConfig.proxyBaseUrl.isNotBlank()
    }

    suspend fun fetchPlayer(identifierInput: String, lastFetchedAt: Long?, etag: String? = null): FetchResult {
        val baseUrl = LevelheadConfig.proxyBaseUrl
        val identifier = sanitizeProxyIdentifier(identifierInput)
        val url = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.addPathSegment("public")
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
            .get()
            .build()

        DebugLogging.logRequestDebug {
            "[LevelheadDebug][network] proxy request: ${url.toString().sanitizeForLogs()}"
        }

        return try {
            executeWithRetries(request, "proxy player").use { response ->
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

                val json = kotlin.runCatching { JsonParser.parseString(body).asJsonObject }.getOrElse {
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
            FetchResult.TemporaryError(ex.message?.sanitizeForLogs())
        } catch (ex: kotlin.coroutines.cancellation.CancellationException) {
            throw ex
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy BedWars data", ex)
            FetchResult.TemporaryError(ex.message?.sanitizeForLogs())
        }
    }

    suspend fun fetchBatch(uuids: List<UUID>): Map<UUID, FetchResult> {
        if (uuids.isEmpty()) return emptyMap()

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

        val url = HttpUrl.parse(LevelheadConfig.proxyBaseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.addPathSegment("public")
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

                val json = kotlin.runCatching { JsonParser.parseString(body).asJsonObject }.getOrElse {
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
            val sanitized = ex.message?.sanitizeForLogs()
            identifierToUuid.values.associateWith { FetchResult.TemporaryError(sanitized) }
        } catch (ex: kotlin.coroutines.cancellation.CancellationException) {
            throw ex
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy BedWars batch data", ex)
            val sanitized = ex.message?.sanitizeForLogs()
            identifierToUuid.values.associateWith { FetchResult.TemporaryError(sanitized) }
        }
    }

    fun resetWarnings() {
        invalidProxyTokenWarned.set(false)
        networkIssueWarned.set(false)
        proxyMisconfiguredWarned.set(false)
    }

    private fun notifyInvalidProxyToken(status: Int, body: String) {
        if (invalidProxyTokenWarned.compareAndSet(false, true)) {
            Levelhead.sendChat("${ChatColor.RED}The stats backend rejected the request. ${ChatColor.YELLOW}Check the backend URL in Levelhead settings.")
        }
        Levelhead.logger.warn(
            "Proxy request was rejected with status {} (bodyLen={})",
            status,
            body.length
        )
    }

    private suspend fun notifyNetworkIssue(ex: IOException) {
        if (networkIssueWarned.compareAndSet(false, true)) {
            Levelhead.sendChat("${ChatColor.RED}Proxy stats request failed. ${ChatColor.YELLOW}Checking backend status...")
            Levelhead.scope.launch(Dispatchers.IO) {
                val isHealthy = checkBackendHealth()
                if (isHealthy) {
                    Levelhead.sendChat("${ChatColor.RED}Proxy stats request failed (Backend Online). ${ChatColor.YELLOW}Will retry automatically.")
                } else {
                    Levelhead.sendChat("${ChatColor.RED}Proxy stats offline. ${ChatColor.YELLOW}Will retry automatically.")
                }
            }
        }
        Levelhead.logger.error("Network error while fetching proxy BedWars data", ex)
    }

    private suspend fun checkBackendHealth(): Boolean {
        val baseUrl = LevelheadConfig.proxyBaseUrl
        val healthUrl = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("healthz")
            ?.build() ?: return false

        val request = Request.Builder()
            .url(healthUrl)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .get()
            .build()

        return try {
            shortTimeoutClient.newCall(request).await().use { response ->
                if (!response.isSuccessful) return@use false
                val body = response.body()?.string() ?: return@use false
                val json = kotlin.runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return@use false
                val status = json.get("status")
                status?.isJsonPrimitive == true && status.asString == "ok"
            }
        } catch (ex: Exception) {
            Levelhead.logger.warn("Failed to check backend health", ex)
            false
        }
    }

    private fun sanitizeProxyIdentifier(identifier: String): String {
        val trimmed = identifier.trim()
        if (trimmed.isEmpty()) {
            return trimmed
        }
        val collapsed = trimmed.replace("-", "")
        return if (collapsed.matches(DebugLogging.TRIMMED_UUID_REGEX)) {
            collapsed.lowercase(Locale.ROOT)
        } else {
            trimmed
        }
    }
}
