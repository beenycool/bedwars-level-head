package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import com.google.gson.JsonObject
import gg.essential.api.EssentialAPI
import gg.essential.universal.ChatColor
import gg.essential.universal.UMinecraft
import okhttp3.HttpUrl
import okhttp3.Request
import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

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
        var fallback: FetchResult? = null
        if (shouldUseProxy()) {
            when (val proxyResult = fetchFromProxy(uuid, lastFetchedAt)) {
                is FetchResult.Success, FetchResult.NotModified -> return proxyResult
                else -> fallback = proxyResult
            }
        }

        val hypixelResult = fetchFromHypixel(uuid)
        return when (hypixelResult) {
            is FetchResult.Success, FetchResult.NotModified -> hypixelResult
            else -> fallback ?: hypixelResult
        }
    }

    private fun shouldUseProxy(): Boolean {
        if (!LevelheadConfig.proxyEnabled) {
            proxyMisconfiguredWarned.set(false)
            return false
        }

        val baseConfigured = LevelheadConfig.proxyBaseUrl.isNotBlank()
        val tokenConfigured = LevelheadConfig.proxyAuthToken.isNotBlank()
        if (!baseConfigured || !tokenConfigured) {
            if (proxyMisconfiguredWarned.compareAndSet(false, true)) {
                sendMessage(
                    "${ChatColor.RED}Proxy enabled but misconfigured. ${ChatColor.YELLOW}Set both a base URL and auth token in Levelhead settings."
                )
            }
            return false
        }

        proxyMisconfiguredWarned.set(false)
        return true
    }

    private fun fetchFromProxy(uuid: UUID, lastFetchedAt: Long?): FetchResult {
        val baseUrl = LevelheadConfig.proxyBaseUrl.trim()
        val uuidNoDashes = uuid.toString().replace("-", "")
        val url = HttpUrl.parse(baseUrl)
            ?.newBuilder()
            ?.addPathSegment("api")
            ?.addPathSegment("player")
            ?.addPathSegment(uuidNoDashes)
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

                val body = response.body()?.string().orEmpty()

                if (!response.isSuccessful) {
                    return when (response.code()) {
                        401, 403 -> {
                            notifyInvalidProxyToken(response.code(), body)
                            FetchResult.PermanentError("PROXY_AUTH")
                        }

                        else -> {
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

                if (!response.isSuccessful) {
                    val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrNull()
                    if (response.code() == 403 && json != null) {
                        val cause = json.get("cause")?.asString ?: "Unknown"
                        notifyInvalidKey(cause.sanitizeForLogs())
                        return FetchResult.PermanentError("INVALID_KEY")
                    }
                    invalidKeyWarned.set(false)
                    networkIssueWarned.set(false)
                    return FetchResult.TemporaryError("HYPIXEL_${response.code()}")
                }

                invalidKeyWarned.set(false)
                networkIssueWarned.set(false)
                val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse Hypixel response", it)
                    return FetchResult.TemporaryError("PARSE_ERROR")
                }
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
        UMinecraft.getMinecraft().addScheduledTask {
            EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", message)
        }
    }

    private fun Long.toHttpDateString(): String {
        return DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(this))
    }
}
