package club.sk1er.mods.levelhead.config.migration

import club.sk1er.mods.levelhead.core.GameMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
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
}
