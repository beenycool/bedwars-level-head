package club.sk1er.mods.levelhead.skywars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.executeWithRetries
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.handleRetryAfterHint
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.parseRetryAfterMillis
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.toHttpDateString
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BackendMode
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.Request
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import net.minecraft.util.EnumChatFormatting as ChatColor

/**
 * Fetcher for SkyWars stats from Hypixel API or proxy.
 */
object SkyWarsFetcher {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"
    
    private val networkIssueWarned = AtomicBoolean(false)
    private val missingKeyWarned = AtomicBoolean(false)

    private fun contributeToCommunityDatabase(uuid: UUID, payload: JsonObject) {
        if (club.sk1er.mods.levelhead.bedwars.ProxyClient.canContribute()) {
            Levelhead.scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                club.sk1er.mods.levelhead.bedwars.ProxyClient.submitPlayer(uuid, payload)
            }
        }
    }

    /**
     * Fetch SkyWars stats for a player using the configured backend mode.
     */
    suspend fun fetchPlayer(uuid: UUID, lastFetchedAt: Long? = null, etag: String? = null): FetchResult {
        val result = when (LevelheadConfig.backendMode) {
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
                        // Check if the payload actually contains SkyWars data
                        if (club.sk1er.mods.levelhead.core.StatsFetcher.findStatsObject(communityResult.payload, club.sk1er.mods.levelhead.core.GameMode.SKYWARS) != null) {
                            return communityResult
                        }
                        // If not, fall back to Hypixel
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
        
        return result
    }

    /**
     * Check if proxy is available for SkyWars stats.
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
        return club.sk1er.mods.levelhead.bedwars.ProxyClient.fetchPlayer(identifier, lastFetchedAt, etag)
    }

    /**
     * Fetch directly from Hypixel API.
     */
    private suspend fun fetchFromHypixel(uuid: UUID): FetchResult {
        val key = LevelheadConfig.apiKey
        if (key.isBlank()) {
            if (missingKeyWarned.compareAndSet(false, true)) {
                Levelhead.sendChat(
                    "${ChatColor.YELLOW}Set your Hypixel API key with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to enable SkyWars stats."
                )
            }
            return FetchResult.PermanentError("MISSING_KEY")
        }

        val url = HttpUrl.parse(HYPIXEL_PLAYER_ENDPOINT)?.newBuilder()
            ?.addQueryParameter("uuid", uuid.toString().replace("-", ""))
            ?.build()

        if (url == null) {
            Levelhead.logger.error("Failed to build Hypixel SkyWars endpoint URL")
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
            executeWithRetries(request, "Hypixel skywars").use { response ->
                val body = response.body()?.string().orEmpty()
                val retryAfterMillis = parseRetryAfterMillis(response.header("Retry-After"))

                if (!response.isSuccessful) {
                    if (response.code() == 429) {
                        handleRetryAfterHint("hypixel", retryAfterMillis)
                    }
                    return FetchResult.TemporaryError("HYPIXEL_${response.code()}")
                }

                val json = runCatching { JsonParser.parseString(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse Hypixel SkyWars response", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }

                handleRetryAfterHint("hypixel", retryAfterMillis)
                networkIssueWarned.set(false)
                missingKeyWarned.set(false)
                FetchResult.Success(json)
            }
        } catch (ex: IOException) {
            if (networkIssueWarned.compareAndSet(false, true)) {
                Levelhead.sendChat("${ChatColor.RED}Hypixel SkyWars stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
            }
            FetchResult.TemporaryError(ex.message)
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch Hypixel SkyWars data", ex)
            FetchResult.TemporaryError(ex.message)
        }
    }

    /**
     * Build CachedSkyWarsStats from a JSON response.
     */
    fun buildCachedStats(payload: JsonObject, etag: String? = null): CachedSkyWarsStats {
        val experience = SkyWarsStats.parseExperience(payload)
        val level = experience?.let { SkyWarsStats.calculateLevel(it) }
        val wins = SkyWarsStats.parseWins(payload)
        val losses = SkyWarsStats.parseLosses(payload)
        val kills = SkyWarsStats.parseKills(payload)
        val deaths = SkyWarsStats.parseDeaths(payload)
        return CachedSkyWarsStats(
            level = level,
            experience = experience,
            wins = wins,
            losses = losses,
            kills = kills,
            deaths = deaths,
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
