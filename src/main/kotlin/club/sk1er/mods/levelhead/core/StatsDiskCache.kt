package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import net.minecraft.client.Minecraft
import java.io.File
import java.util.UUID

/**
 * Persists the in-memory stats cache so a client restart does not re-fetch every
 * player it already had. Best-effort: a corrupt or unreadable file is ignored.
 */
object StatsDiskCache {
    private const val FILE_NAME = "levelhead-stats-cache.json"
    private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    private const val MAX_ENTRIES = 500

    private fun file(): File = File(Minecraft.getMinecraft().mcDataDir, FILE_NAME)

    fun load(store: StatsStore) {
        val target = file()
        if (!target.isFile) return
        val text = runCatching { target.readText() }.getOrNull() ?: return
        val root = runCatching { JsonParser().parse(text).asJsonObject }.getOrNull() ?: return
        val entries = root.get("entries")?.takeIf { it.isJsonArray }?.asJsonArray ?: return
        val now = System.currentTimeMillis()
        var restored = 0

        entries.forEach { element ->
            val entry = element.takeIf { it.isJsonObject }?.asJsonObject ?: return@forEach
            val uuidText = entry.string("u") ?: return@forEach
            val modeName = entry.string("m") ?: return@forEach
            val uuid = runCatching { UUID.fromString(uuidText) }.getOrNull() ?: return@forEach
            val gameMode = runCatching { GameMode.valueOf(modeName) }.getOrNull() ?: return@forEach
            val fetchedAt = entry.long("f") ?: return@forEach
            if (now - fetchedAt > MAX_AGE_MS) return@forEach
            val stats = decode(entry, gameMode, fetchedAt, entry.bool("n") ?: false) ?: return@forEach
            store.restore(uuid, gameMode, stats)
            restored++
        }

        Levelhead.logger.debug("Restored {} cached players from disk", restored)
    }

    fun save(store: StatsStore) {
        val snapshot = store.snapshot()
        if (snapshot.isEmpty()) return

        val entries = JsonArray()
        snapshot.entries.take(MAX_ENTRIES).forEach { (key, stats) ->
            entries.add(encode(key, stats))
        }

        val root = JsonObject()
        root.addProperty("version", 1)
        root.add("entries", entries)

        val target = file()
        runCatching {
            target.parentFile?.mkdirs()
            target.writeText(Levelhead.gson.toJson(root))
        }.onFailure { Levelhead.logger.warn("Failed to persist stats cache", it) }
    }

    fun clear() {
        runCatching { file().delete() }
    }

    private fun encode(key: StatsKey, stats: GameStats): JsonObject {
        val entry = JsonObject()
        entry.addProperty("u", key.uuid.toString())
        entry.addProperty("m", key.gameMode.name)
        entry.addProperty("f", stats.fetchedAt)
        entry.addProperty("n", stats.nicked)
        when (stats) {
            is GameStats.Bedwars -> {
                stats.star?.let { entry.addProperty("star", it) }
                stats.fkdr?.let { entry.addProperty("fkdr", it) }
                stats.starIcon?.let { entry.addProperty("icon", it) }
                stats.wins?.let { entry.addProperty("wins", it) }
                stats.losses?.let { entry.addProperty("losses", it) }
                stats.finalKills?.let { entry.addProperty("fk", it) }
                stats.finalDeaths?.let { entry.addProperty("fd", it) }
                stats.bedsBroken?.let { entry.addProperty("bb", it) }
                stats.bedsLost?.let { entry.addProperty("bl", it) }
            }
            is GameStats.Duels -> {
                stats.wins?.let { entry.addProperty("wins", it) }
                stats.losses?.let { entry.addProperty("losses", it) }
                stats.kills?.let { entry.addProperty("kills", it) }
                stats.deaths?.let { entry.addProperty("deaths", it) }
                stats.winstreak?.let { entry.addProperty("ws", it) }
            }
            is GameStats.SkyWars -> {
                stats.level?.let { entry.addProperty("level", it) }
                stats.wins?.let { entry.addProperty("wins", it) }
                stats.losses?.let { entry.addProperty("losses", it) }
                stats.kills?.let { entry.addProperty("kills", it) }
                stats.deaths?.let { entry.addProperty("deaths", it) }
            }
        }
        return entry
    }

    private fun decode(entry: JsonObject, gameMode: GameMode, fetchedAt: Long, nicked: Boolean): GameStats? =
        when (gameMode) {
            GameMode.BEDWARS -> GameStats.Bedwars(
                star = entry.int("star"),
                fkdr = entry.double("fkdr"),
                nicked = nicked,
                fetchedAt = fetchedAt,
                starIcon = entry.string("icon"),
                wins = entry.int("wins"),
                losses = entry.int("losses"),
                finalKills = entry.int("fk"),
                finalDeaths = entry.int("fd"),
                bedsBroken = entry.int("bb"),
                bedsLost = entry.int("bl")
            )
            GameMode.DUELS -> GameStats.Duels(
                wins = entry.int("wins"),
                losses = entry.int("losses"),
                kills = entry.int("kills"),
                deaths = entry.int("deaths"),
                nicked = nicked,
                fetchedAt = fetchedAt,
                winstreak = entry.int("ws")
            )
            GameMode.SKYWARS -> GameStats.SkyWars(
                level = entry.double("level"),
                wins = entry.int("wins"),
                losses = entry.int("losses"),
                kills = entry.int("kills"),
                deaths = entry.int("deaths"),
                nicked = nicked,
                fetchedAt = fetchedAt
            )
        }

    private fun JsonObject.int(key: String): Int? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asInt }.getOrNull() }

    private fun JsonObject.long(key: String): Long? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asLong }.getOrNull() }

    private fun JsonObject.double(key: String): Double? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asDouble }.getOrNull() }

    private fun JsonObject.bool(key: String): Boolean? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asBoolean }.getOrNull() }

    private fun JsonObject.string(key: String): String? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asString }.getOrNull() }
}
