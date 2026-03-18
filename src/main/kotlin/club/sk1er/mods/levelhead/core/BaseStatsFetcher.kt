package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.executeWithRetries
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.handleRetryAfterHint
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.parseRetryAfterMillis
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.Request
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import net.minecraft.util.EnumChatFormatting as ChatColor

abstract class BaseStatsFetcher {
    private val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"

    protected val missingKeyWarned = AtomicBoolean(false)
    protected val invalidKeyWarned = AtomicBoolean(false)
    protected val networkIssueWarned = AtomicBoolean(false)

    protected abstract val gameMode: GameMode
    protected abstract val modeName: String

    protected fun contributeToCommunityDatabase(uuid: UUID, payload: JsonObject) {
        if (ProxyClient.canContribute()) {
            Levelhead.scope.launch(Dispatchers.IO) {
                ProxyClient.submitPlayer(uuid, payload)
            }
        }
    }

    suspend fun fetchPlayer(uuid: UUID, lastFetchedAt: Long? = null, etag: String? = null): FetchResult {
        return when (LevelheadConfig.backendMode) {
            BackendMode.OFFLINE -> FetchResult.PermanentError("OFFLINE_MODE")
            BackendMode.COMMUNITY_CACHE_ONLY -> {
                if (isProxyAvailable()) {
                    fetchFromProxy(uuid.toString(), lastFetchedAt, etag)
                } else {
                    FetchResult.PermanentError("COMMUNITY_DATABASE_UNAVAILABLE")
                }
            }
            BackendMode.DIRECT_API -> {
                val hypixelResult = fetchFromHypixel(uuid)
                if (hypixelResult is FetchResult.Success) {
                    contributeToCommunityDatabase(uuid, hypixelResult.payload)
                }
                hypixelResult
            }
            BackendMode.FALLBACK -> {
                if (isProxyAvailable()) {
                    val communityResult = fetchFromProxy(uuid.toString(), lastFetchedAt, etag)
                    if (communityResult is FetchResult.Success) {
                        if (StatsFetcher.findStatsObject(communityResult.payload, gameMode) != null) {
                            return communityResult
                        }
                    } else if (communityResult is FetchResult.NotModified) {
                        return communityResult
                    }
                }

                val hypixelResult = fetchFromHypixel(uuid)
                if (hypixelResult is FetchResult.Success) {
                    contributeToCommunityDatabase(uuid, hypixelResult.payload)
                }
                hypixelResult
            }
        }
    }

    private fun isProxyAvailable(): Boolean {
        if (!LevelheadConfig.proxyEnabled) return false
        if (!LevelheadConfig.communityDatabase) return false
        return LevelheadConfig.proxyBaseUrl.isNotBlank()
    }

    private suspend fun fetchFromProxy(identifier: String, lastFetchedAt: Long?, etag: String?): FetchResult {
        return ProxyClient.fetchPlayer(identifier, lastFetchedAt, etag)
    }

    private suspend fun fetchFromHypixel(uuid: UUID): FetchResult {
        val key = LevelheadConfig.apiKey
        if (key.isBlank()) {
            notifyMissingKey()
            return FetchResult.PermanentError("MISSING_KEY")
        }

        val url = HttpUrl.parse(HYPIXEL_PLAYER_ENDPOINT)?.newBuilder()
            ?.addQueryParameter("uuid", uuid.toString().replace("-", ""))
            ?.build()

        if (url == null) {
            Levelhead.logger.error("Failed to build Hypixel endpoint URL")
            return FetchResult.PermanentError("INVALID_URL")
        }

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .header("API-Key", key)
            .get()
            .build()

        val debugEnabled = DebugLogging.isRequestDebugEnabled()
        val maskedUuid = if (debugEnabled) uuid.maskForLogs() else null
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][network] request start: endpoint=$HYPIXEL_PLAYER_ENDPOINT, uuid=$maskedUuid, hasApiKey=${key.isNotBlank()}"
        }

        return try {
            executeWithRetries(request, "Hypixel $modeName").use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))

                DebugLogging.logRequestDebug {
                    val statusCode = response.code()
                    val isNotModified = statusCode == 304
                    val bodyLength = body.length
                    "[LevelheadDebug][network] response: status=$statusCode${if (isNotModified) " (Not Modified)" else ""}, bodyLength=$bodyLength"
                }

                if (!response.isSuccessful) {
                    val json = kotlin.runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull()
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
                            "Hypixel rate limited requests. Retry after {} ms.",
                            retryAfterMillis ?: -1
                        )
                    }
                    return FetchResult.TemporaryError("HYPIXEL_${response.code()}")
                }

                invalidKeyWarned.set(false)
                networkIssueWarned.set(false)
                val parseResult = kotlin.runCatching { JsonParser.parseString(body).asJsonObject }
                val json = parseResult.getOrElse {
                    DebugLogging.logRequestDebug {
                        "[LevelheadDebug][network] parse: success=false, error=${it::class.simpleName}"
                    }
                    Levelhead.logger.error("Failed to parse Hypixel response", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }
                
                DebugLogging.logRequestDebug {
                    "[LevelheadDebug][network] parse: success=true"
                }
                handleRetryAfterHint("hypixel", retryAfterMillis)
                missingKeyWarned.set(false)
                
                FetchResult.Success(json)
            }
        } catch (ex: IOException) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][network] error: ${ex::class.simpleName}"
            }
            notifyNetworkIssue(ex)
            FetchResult.TemporaryError(ex.message?.sanitizeForLogs())
        } catch (ex: kotlin.coroutines.cancellation.CancellationException) {
            throw ex
        } catch (ex: Exception) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][network] error: ${ex::class.simpleName}"
            }
            Levelhead.logger.error("Failed to fetch Hypixel data", ex)
            FetchResult.TemporaryError(ex.message?.sanitizeForLogs())
        }
    }

    open fun resetWarnings() {
        missingKeyWarned.set(false)
        invalidKeyWarned.set(false)
        networkIssueWarned.set(false)
    }

    private fun notifyMissingKey() {
        if (LevelheadConfig.shouldSuppressBackendWarnings()) return

        if (missingKeyWarned.compareAndSet(false, true)) {
            Levelhead.sendChat(
                "${ChatColor.YELLOW}Set your Hypixel API key with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to enable $modeName stats."
            )
        }
    }

    private fun notifyInvalidKey(cause: String) {
        if (cause.contains("api key", ignoreCase = true)) {
            if (invalidKeyWarned.compareAndSet(false, true)) {
                Levelhead.sendChat(
                    "${ChatColor.RED}Hypixel rejected your API key (${cause.trim()}). ${ChatColor.YELLOW}Update it with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW}."
                )
            }
        } else {
            Levelhead.logger.warn("Hypixel API returned error: {}", cause.sanitizeForLogs())
        }
    }

    private fun notifyNetworkIssue(ex: IOException) {
        if (networkIssueWarned.compareAndSet(false, true)) {
            Levelhead.sendChat("${ChatColor.RED}Hypixel stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
        }
        Levelhead.logger.error("Network error while fetching Hypixel data", ex)
    }
}