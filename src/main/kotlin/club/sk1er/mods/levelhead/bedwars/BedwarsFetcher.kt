package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import com.google.gson.JsonObject
import gg.essential.api.EssentialAPI
import gg.essential.api.utils.Multithreading
import gg.essential.universal.ChatColor
import okhttp3.HttpUrl
import okhttp3.Request
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

object BedwarsFetcher {
    private const val HYPIXEL_PLAYER_ENDPOINT = "https://api.hypixel.net/player"

    private val missingKeyWarned = AtomicBoolean(false)
    private val invalidKeyWarned = AtomicBoolean(false)

    fun fetchPlayer(uuid: UUID): JsonObject? {
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
                val json = Levelhead.jsonParser.parse(body).asJsonObject
                if (!json.get("success")?.asBoolean ?: false) {
                    val cause = json.get("cause")?.asString ?: "Unknown"
                    notifyInvalidKey(cause)
                    return null
                }
                invalidKeyWarned.set(false)
                json
            }
        } catch (ex: Exception) {
            Levelhead.logger.error("Failed to fetch Hypixel BedWars data", ex)
            null
        }
    }

    fun resetWarnings() {
        missingKeyWarned.set(false)
        invalidKeyWarned.set(false)
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
            Levelhead.logger.warn("Hypixel API returned error: {}", cause)
        }
    }

    private fun sendMessage(message: String) {
        Multithreading.runOnMainThread {
            EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", message)
        }
    }
}
