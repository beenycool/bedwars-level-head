package club.sk1er.mods.levelhead.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DisplayManagerHeaderTest {

    @Test
    fun `managedHeaderMode recognizes default and legacy managed headers`() {
        assertEquals(GameMode.BEDWARS, DisplayManager.managedHeaderMode("BedWars Star"))
        assertEquals(GameMode.BEDWARS, DisplayManager.managedHeaderMode("BedWars Level"))
        assertEquals(GameMode.DUELS, DisplayManager.managedHeaderMode("Duels Division"))
        assertEquals(GameMode.DUELS, DisplayManager.managedHeaderMode("Duels Wins"))
        assertEquals(GameMode.SKYWARS, DisplayManager.managedHeaderMode("SkyWars Star"))
    }

    @Test
    fun `normalizedManagedHeader rewrites stale mode defaults to target mode`() {
        assertEquals("BedWars Star", DisplayManager.normalizedManagedHeader("SkyWars Star", GameMode.BEDWARS))
        assertEquals("Duels Division", DisplayManager.normalizedManagedHeader("BedWars Star", GameMode.DUELS))
        assertEquals("SkyWars Star", DisplayManager.normalizedManagedHeader("Duels Wins", GameMode.SKYWARS))
    }

    @Test
    fun `normalizedManagedHeader preserves custom headers`() {
        assertNull(DisplayManager.normalizedManagedHeader("Final Kills", GameMode.BEDWARS))
    }

    @Test
    fun `normalizedManagedHeader fills blanks with target default`() {
        assertEquals("BedWars Star", DisplayManager.normalizedManagedHeader("", GameMode.BEDWARS))
        assertEquals("SkyWars Star", DisplayManager.normalizedManagedHeader(null, GameMode.SKYWARS))
    }
}
