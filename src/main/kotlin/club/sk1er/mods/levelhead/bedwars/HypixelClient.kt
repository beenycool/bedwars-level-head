package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.executeWithRetries
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.handleRetryAfterHint
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.parseRetryAfterMillis
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import net.minecraft.util.EnumChatFormatting as ChatColor
import okhttp3.HttpUrl
import okhttp3.Request
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

object HypixelClient {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"

    private val missingKeyWarned = AtomicBoolean(false)
    private val invalidKeyWarned = AtomicBoolean(false)
    private val networkIssueWarned = AtomicBoolean(false)

    suspend fun fetchPlayer(uuid: UUID): FetchResult {
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

        val debugEnabled = DebugLogging.isRequestDebugEnabled()
        val maskedUuid = if (debugEnabled) uuid.maskForLogs() else null
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][network] request start: endpoint=${HYPIXEL_PLAYER_ENDPOINT}, uuid=$maskedUuid, hasApiKey=${key.isNotBlank()}"
        }

        return try {
            executeWithRetries(request, "Hypixel player").use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))

                DebugLogging.logRequestDebug {
                    val statusCode = response.code()
                    val isNotModified = statusCode == 304
                    val bodyLength = body.length
                    "[LevelheadDebug][network] response: status=$statusCode${if (isNotModified) " (Not Modified)" else ""}, bodyLength=$bodyLength"
                }

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
                val parseResult = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }
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

                FetchResult.Success(json)
            }
        } catch (ex: IOException) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][network] error: ${ex::class.simpleName}"
            }
            notifyNetworkIssue(ex)
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][network] error: ${ex::class.simpleName}"
            }
            Levelhead.logger.error("Failed to fetch Hypixel BedWars data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    fun resetWarnings() {
        missingKeyWarned.set(false)
        invalidKeyWarned.set(false)
        networkIssueWarned.set(false)
    }

    private fun notifyMissingKey() {
        // Suppress warnings when user has API key set and using shared backend
        if (LevelheadConfig.shouldSuppressBackendWarnings()) return

        if (missingKeyWarned.compareAndSet(false, true)) {
            Levelhead.sendChat(
                "${ChatColor.YELLOW}Set your Hypixel API key with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to enable BedWars stats."
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
        Levelhead.logger.error("Network error while fetching Hypixel BedWars data", ex)
    }
}
