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
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

object BedwarsFetcher {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"

    private val missingKeyWarned = AtomicBoolean(false)
    private val invalidKeyWarned = AtomicBoolean(false)
    private val invalidProxyTokenWarned = AtomicBoolean(false)
    private val networkIssueWarned = AtomicBoolean(false)

    fun fetchPlayer(uuid: UUID): JsonObject? {
        if (shouldUseProxy()) {
            fetchFromProxy(uuid)?.let { return it }
        }
        return fetchFromHypixel(uuid)
    }

    private fun shouldUseProxy(): Boolean {
        return LevelheadConfig.proxyEnabled && LevelheadConfig.proxyBaseUrl.isNotBlank()
    }

    private fun fetchFromProxy(uuid: UUID): JsonObject? {
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
            return null
        }

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .apply {
                LevelheadConfig.proxyAuthToken.takeIf { it.isNotBlank() }?.let { token ->
                    header("Authorization", "Bearer $token")
                }
            }
            .get()
            .build()

        return try {
            Levelhead.okHttpClient.newCall(request).execute().use { response ->
                val body = response.body()?.string().orEmpty()

                if (!response.isSuccessful) {
                    when (response.code()) {
                        401, 403 -> notifyInvalidProxyToken(response.code(), body)
                        else -> Levelhead.logger.error(
                            "Proxy request failed with status {}: {}",
                            response.code(),
                            body.sanitizeForLogs().take(200)
                        )
                    }
                    return null
                }

                invalidProxyTokenWarned.set(false)

                val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse proxy response body", it)
                    return null
                }

                if (json.get("success")?.asBoolean == false) {
                    Levelhead.logger.warn("Proxy response reported success=false: {}", body.sanitizeForLogs().take(200))
                    return null
                }

                networkIssueWarned.set(false)
                json
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            null
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch proxy BedWars data", ex)
            null
        }
    }

    private fun fetchFromHypixel(uuid: UUID): JsonObject? {
        val key = LevelheadConfig.apiKey
        if (key.isBlank()) {
            notifyMissingKey()
            return null
        }

        val url = HttpUrl.parse(HYPIXEL_PLAYER_ENDPOINT)?.newBuilder()
            ?.addQueryParameter("key", key)
            ?.addQueryParameter("uuid", uuid.toString().replace("-", ""))
            ?.build()

        if (url == null) {
            Levelhead.logger.error("Failed to build Hypixel BedWars endpoint URL")
            return null
        }

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .get()
            .build()

        return try {
            Levelhead.okHttpClient.newCall(request).execute().use { response ->
                val body = response.body()?.string() ?: return null
                val json = kotlin.runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrElse {
                    Levelhead.logger.error("Failed to parse Hypixel response body", it)
                    return null
                }
                if (json.get("success")?.asBoolean != true) {
                    val cause = json.get("cause")?.asString ?: "Unknown"
                    notifyInvalidKey(cause.sanitizeForLogs())
                    return null
                }
                invalidKeyWarned.set(false)
                networkIssueWarned.set(false)
                json
            }
        } catch (ex: IOException) {
            notifyNetworkIssue(ex)
            null
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch Hypixel BedWars data", ex)
            null
        }
    }

    fun resetWarnings() {
        missingKeyWarned.set(false)
        invalidKeyWarned.set(false)
        invalidProxyTokenWarned.set(false)
        networkIssueWarned.set(false)
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
        listOf(LevelheadConfig.apiKey, LevelheadConfig.proxyAuthToken)
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
            sendMessage("${ChatColor.RED}Levelhead couldn't reach BedWars stats. ${ChatColor.YELLOW}Check your connection or proxy.")
        }
        Levelhead.logger.error("Network error while fetching BedWars data", ex)
    }

    private fun sendMessage(message: String) {
        UMinecraft.getMinecraft().addScheduledTask {
            EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", message)
        }
    }
}
