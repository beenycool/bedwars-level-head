package club.sk1er.mods.levelhead.duels

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.executeWithRetries
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.handleRetryAfterHint
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.parseRetryAfterMillis
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.toHttpDateString
import club.sk1er.mods.levelhead.config.LevelheadConfig
import com.google.gson.JsonObject
import okhttp3.HttpUrl
import okhttp3.Request
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import net.minecraft.util.EnumChatFormatting as ChatColor

/**
 * Fetcher for Duels stats from Hypixel API or proxy.
 */
object DuelsFetcher {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"
    
    private val networkIssueWarned = AtomicBoolean(false)
    private val missingKeyWarned = AtomicBoolean(false)

    /**
     * Fetch Duels stats for a player.
     * Tries proxy first if available, then falls back to direct Hypixel API.
     */
    suspend fun fetchPlayer(uuid: UUID, lastFetchedAt: Long? = null, etag: String? = null): FetchResult {
        // Try proxy first if enabled and configured
        if (isProxyAvailable()) {
            val proxyResult = fetchFromProxy(uuid.toString(), lastFetchedAt, etag)
            if (proxyResult !is FetchResult.TemporaryError) {
                return proxyResult
            }
        }

        // Fall back to direct Hypixel API
        return fetchFromHypixel(uuid)
    }

    /**
     * Check if proxy is available for Duels stats.
     */
    private fun isProxyAvailable(): Boolean {
        if (!LevelheadConfig.proxyEnabled) return false
        if (!LevelheadConfig.communityDatabase) return false
        return LevelheadConfig.proxyBaseUrl.isNotBlank()
    }

    /**
     * Fetch from the proxy/community database.
     */
    private suspend fun fetchFromProxy(identifier: String, lastFetchedAt: Long?, etag: String?): FetchResult {
        val baseUrl = LevelheadConfig.resolveDbUrl()
        val sanitizedId = sanitizeIdentifier(identifier)
        val isPublic = LevelheadConfig.proxyAuthToken.isBlank()
        
        val url = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.apply { if (isPublic) addPathSegment("public") }
            ?.addPathSegment("player")
            ?.addPathSegment(sanitizedId)
            ?.build()

        if (url == null) {
            Levelhead.logger.error(
                "Failed to build proxy Duels endpoint URL from base '{}'",
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
                etag?.takeIf { it.isNotBlank() }?.let { tag ->
                    header("If-None-Match", tag)
                } ?: lastFetchedAt?.let { since ->
                    header("If-Modified-Since", since.toHttpDateString())
                }
            }
            .get()
            .build()

        return try {
            executeWithRetries(request, "proxy duels").use { response ->
                if (response.code() == 304) {
                    networkIssueWarned.set(false)
                    return FetchResult.NotModified
                }

                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))
                val body = response.body()?.string().orEmpty()

                if (!response.isSuccessful) {
                    return when (response.code()) {
                        401, 403 -> FetchResult.PermanentError("PROXY_AUTH")
                        429 -> {
                            handleRetryAfterHint("proxy", retryAfterMillis)
                            FetchResult.TemporaryError("PROXY_RATE_LIMIT")
                        }
                        else -> {
                            handleRetryAfterHint("proxy", retryAfterMillis)
                            FetchResult.TemporaryError("HTTP_${response.code()}")
                        }
                    }
                }

                val json = runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse proxy Duels response", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }

                if (json.get("success")?.asBoolean == false) {
                    return FetchResult.TemporaryError("PROXY_ERROR")
                }

                networkIssueWarned.set(false)
                handleRetryAfterHint("proxy", retryAfterMillis)
                val newEtag = response.header("ETag")
                FetchResult.Success(json, newEtag)
            }
        } catch (ex: IOException) {
            if (networkIssueWarned.compareAndSet(false, true)) {
                Levelhead.sendChat("${ChatColor.RED}Duels stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
            }
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy Duels data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    /**
     * Fetch directly from Hypixel API.
     */
    private suspend fun fetchFromHypixel(uuid: UUID): FetchResult {
        val key = LevelheadConfig.apiKey
        if (key.isBlank()) {
            if (missingKeyWarned.compareAndSet(false, true)) {
                Levelhead.sendChat(
                    "${ChatColor.YELLOW}Set your Hypixel API key with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to enable Duels stats."
                )
            }
            return FetchResult.PermanentError("MISSING_KEY")
        }

        val url = HttpUrl.parse(HYPIXEL_PLAYER_ENDPOINT)?.newBuilder()
            ?.addQueryParameter("uuid", uuid.toString().replace("-", ""))
            ?.build()

        if (url == null) {
            Levelhead.logger.error("Failed to build Hypixel Duels endpoint URL")
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
            executeWithRetries(request, "Hypixel duels").use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))

                if (!response.isSuccessful) {
                    if (response.code() == 429) {
                        handleRetryAfterHint("hypixel", retryAfterMillis)
                    }
                    return FetchResult.TemporaryError("HYPIXEL_${response.code()}")
                }

                val json = runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse Hypixel Duels response", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }

                handleRetryAfterHint("hypixel", retryAfterMillis)
                networkIssueWarned.set(false)
                missingKeyWarned.set(false)
                FetchResult.Success(json)
            }
        } catch (ex: IOException) {
            if (networkIssueWarned.compareAndSet(false, true)) {
                Levelhead.sendChat("${ChatColor.RED}Hypixel Duels stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
            }
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch Hypixel Duels data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    /**
     * Build CachedDuelsStats from a JSON response.
     */
    fun buildCachedStats(payload: JsonObject, etag: String? = null): CachedDuelsStats {
        val wins = DuelsStats.parseWins(payload)
        val losses = DuelsStats.parseLosses(payload)
        val kills = DuelsStats.parseKills(payload)
        val deaths = DuelsStats.parseDeaths(payload)
        val winstreak = DuelsStats.parseWinstreak(payload)
        val bestWinstreak = DuelsStats.parseBestWinstreak(payload)
        return CachedDuelsStats(
            wins = wins,
            losses = losses,
            kills = kills,
            deaths = deaths,
            winstreak = winstreak,
            bestWinstreak = bestWinstreak,
            fetchedAt = System.currentTimeMillis(),
            etag = etag
        )
    }

    fun resetWarnings() {
        networkIssueWarned.set(false)
        missingKeyWarned.set(false)
    }

    private fun sanitizeIdentifier(identifier: String): String {
        val trimmed = identifier.trim()
        if (trimmed.isEmpty()) return trimmed
        val collapsed = trimmed.replace("-", "")
        return if (collapsed.matches(Regex("^[0-9a-f]{32}$", RegexOption.IGNORE_CASE))) {
            collapsed.lowercase(Locale.ROOT)
        } else {
            trimmed
        }
    }
}
