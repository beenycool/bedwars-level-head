package club.sk1er.mods.levelhead.contract

import club.sk1er.mods.levelhead.core.GameMode
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File

/**
 * Read-only view over the shared `contract/player-stats.json` fixture.
 *
 * The fixture lives at the repository root because the backend Jest suite reads the
 * same file. Gradle runs the mod tests from `versions/1.8.9`, so walk up until the
 * fixture is found instead of depending on a working-directory depth.
 */
object ContractFixture {

    data class Case(
        val mode: GameMode,
        val uuid: String,
        val upstream: JsonObject,
        val minimalStats: JsonObject,
        val expectedFooter: String,
        val expectedTag: String,
    )

    val cases: List<Case> by lazy {
        val file = File(findRepoRoot(), "contract/player-stats.json")
        val root = JsonParser.parseString(file.readText(Charsets.UTF_8)).asJsonObject
        root.getAsJsonArray("cases").map { element ->
            val case = element.asJsonObject
            Case(
                mode = GameMode.valueOf(case.get("mode").asString),
                uuid = case.get("uuid").asString,
                upstream = case.getAsJsonObject("upstream"),
                minimalStats = case.getAsJsonObject("minimalStats"),
                expectedFooter = case.get("expectedFooter").asString,
                expectedTag = case.get("expectedTag").asString,
            )
        }
    }

    fun long(stats: JsonObject, key: String): Long {
        val element = stats.get(key) ?: error("Fixture minimalStats is missing '$key'")
        check(!element.isJsonNull) { "Fixture minimalStats '$key' is null" }
        return element.asLong
    }

    fun int(stats: JsonObject, key: String): Int {
        val element = stats.get(key) ?: error("Fixture minimalStats is missing '$key'")
        check(!element.isJsonNull) { "Fixture minimalStats '$key' is null" }
        return element.asInt
    }

    fun string(stats: JsonObject, key: String): String {
        val element = stats.get(key) ?: error("Fixture minimalStats is missing '$key'")
        return element.asString
    }

    private fun findRepoRoot(): File {
        var directory: File? = File(System.getProperty("user.dir")).absoluteFile
        while (directory != null) {
            if (File(directory, "contract/player-stats.json").isFile) {
                return directory
            }
            directory = directory.parentFile
        }
        error("Could not find contract/player-stats.json above ${System.getProperty("user.dir")}")
    }
}
