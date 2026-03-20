package club.sk1er.mods.levelhead.config.migration

import club.sk1er.mods.levelhead.core.GameMode
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test


class ConfigMigratorTest {

    @Test
    fun `managedHeaderMode recognizes default and legacy managed headers`() {
        assertEquals(GameMode.BEDWARS, ConfigMigrator.managedHeaderMode("BedWars Star"))
        assertEquals(GameMode.BEDWARS, ConfigMigrator.managedHeaderMode("BedWars Level"))
        assertEquals(GameMode.DUELS, ConfigMigrator.managedHeaderMode("Duels Division"))
        assertEquals(GameMode.DUELS, ConfigMigrator.managedHeaderMode("Duels Wins"))
        assertEquals(GameMode.SKYWARS, ConfigMigrator.managedHeaderMode("SkyWars Star"))
    }

    @Test
    fun `normalizedManagedHeader rewrites stale mode defaults to target mode`() {
        assertEquals("BedWars Star", ConfigMigrator.normalizedManagedHeader("SkyWars Star", GameMode.BEDWARS))
        assertEquals("Duels Division", ConfigMigrator.normalizedManagedHeader("BedWars Star", GameMode.DUELS))
        assertEquals("SkyWars Star", ConfigMigrator.normalizedManagedHeader("Duels Wins", GameMode.SKYWARS))
    }

    @Test
    fun `normalizedManagedHeader preserves custom headers`() {
        assertNull(ConfigMigrator.normalizedManagedHeader("Final Kills", GameMode.BEDWARS))
    }

    @Test
    fun `normalizedManagedHeader fills blanks with target default`() {
        assertEquals("BedWars Star", ConfigMigrator.normalizedManagedHeader("", GameMode.BEDWARS))
        assertEquals("SkyWars Star", ConfigMigrator.normalizedManagedHeader(null, GameMode.SKYWARS))
    }

    @Test
    fun `migrate V0 to V2`() {
        val payload = """
            {
                "head": [
                    {
                        "type": "BEDWARS_STAR"
                    },
                    {
                        "type": "DUELS_WINS"
                    }
                ]
            }
        """.trimIndent()

        val json = JsonParser.parseString(payload).asJsonObject
        val migrated = ConfigMigrator.migrate(json)

        assertEquals(2, migrated.getAsJsonObject("master").get("version").asInt)

        val heads = migrated.getAsJsonArray("head")
        assertEquals(2, heads.size())

        val head0 = heads.get(0).asJsonObject
        assertEquals("BEDWARS", head0.get("gameMode").asString)

        val head1 = heads.get(1).asJsonObject
        assertEquals("BEDWARS", head1.get("gameMode").asString)
    }

    @Test
    fun `migrate V1 to V2`() {
        val payload = """
            {
                "master": {
                    "version": 1
                },
                "head": [
                    {
                        "gameMode": "SKYWARS",
                        "headerString": "SkyWars Star"
                    }
                ]
            }
        """.trimIndent()

        val json = JsonParser.parseString(payload).asJsonObject
        val migrated = ConfigMigrator.migrate(json)

        assertEquals(2, migrated.getAsJsonObject("master").get("version").asInt)

        val heads = migrated.getAsJsonArray("head")
        val head0 = heads.get(0).asJsonObject
        assertEquals("BEDWARS", head0.get("gameMode").asString)
        assertEquals("BedWars Star", head0.get("headerString").asString)
    }

    @Test
    fun `migrate V2 idempotence`() {
        val payload = """
            {
                "master": {
                    "version": 2
                },
                "head": [
                    {
                        "gameMode": "SKYWARS",
                        "headerString": "Custom Text"
                    }
                ]
            }
        """.trimIndent()

        val json = JsonParser.parseString(payload).asJsonObject
        val migrated = ConfigMigrator.migrate(json)

        assertEquals(2, migrated.getAsJsonObject("master").get("version").asInt)

        val heads = migrated.getAsJsonArray("head")
        val head0 = heads.get(0).asJsonObject
        assertEquals("SKYWARS", head0.get("gameMode").asString)
        assertEquals("Custom Text", head0.get("headerString").asString)
    }
}
