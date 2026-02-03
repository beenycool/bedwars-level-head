package club.sk1er.mods.levelhead.skywars

import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for SkyWars level calculation.
 * Tests against 25Karma reference values to ensure accuracy.
 */
class SkyWarsStatsTest {

    @Test
    fun `test level 1 with 0 XP`() {
        val level = SkyWarsStats.calculateLevel(0)
        assertEquals(1.0, level, 0.01)
    }

    @Test
    fun `test level 1 with minimal XP`() {
        val level = SkyWarsStats.calculateLevel(5)
        assertEquals(1.5, level, 0.01)
    }

    @Test
    fun `test level 2 boundary`() {
        // Exactly 10 XP should be level 2.0
        val level = SkyWarsStats.calculateLevel(10)
        assertEquals(2.0, level, 0.01)
    }

    @Test
    fun `test level 3 boundary`() {
        // Exactly 25 XP should be level 3.0
        val level = SkyWarsStats.calculateLevel(25)
        assertEquals(3.0, level, 0.01)
    }

    @Test
    fun `test level 5 boundary`() {
        // Exactly 75 XP should be level 5.0
        val level = SkyWarsStats.calculateLevel(75)
        assertEquals(5.0, level, 0.01)
    }

    @Test
    fun `test level 10 boundary`() {
        // Exactly 1000 XP should be level 10.0
        val level = SkyWarsStats.calculateLevel(1000)
        assertEquals(10.0, level, 0.01)
    }

    @Test
    fun `test level 19 boundary`() {
        // Exactly 4500 XP should be level 19.0
        val level = SkyWarsStats.calculateLevel(4500)
        assertEquals(19.0, level, 0.01)
    }

    @Test
    fun `test level 20 boundary`() {
        // Level 20 requires 4500 + 5000 = 9500 XP
        val level = SkyWarsStats.calculateLevel(9500)
        assertEquals(20.0, level, 0.01)
    }

    @Test
    fun `test level 20 with partial progress`() {
        // 7000 XP = 4500 (to reach 19) + 2500 towards level 20
        // 2500/5000 = 0.5 progress, so level 19.5
        val level = SkyWarsStats.calculateLevel(7000)
        assertEquals(19.5, level, 0.01)
    }

    @Test
    fun `test level 21 boundary`() {
        // Level 21 requires 4500 + 10000 = 14500 XP
        val level = SkyWarsStats.calculateLevel(14500)
        assertEquals(21.0, level, 0.01)
    }

    @Test
    fun `test level 50 calculation`() {
        // Level 50: 19 levels from table + 31 levels at 5000 XP each
        // Total XP = 4500 + (31 * 5000) = 159500
        val level = SkyWarsStats.calculateLevel(159500)
        assertEquals(50.0, level, 0.01)
    }

    @Test
    fun `test level 100 calculation`() {
        // Level 100: 19 levels from table + 81 levels at 5000 XP each
        // Total XP = 4500 + (81 * 5000) = 409500
        val level = SkyWarsStats.calculateLevel(409500)
        assertEquals(100.0, level, 0.01)
    }

    @Test
    fun `test level 500 calculation`() {
        // Level 500: 19 levels from table + 481 levels at 5000 XP each
        // Total XP = 4500 + (481 * 5000) = 2409500
        val level = SkyWarsStats.calculateLevel(2409500)
        assertEquals(500.0, level, 0.01)
    }

    @Test
    fun `test max level cap`() {
        // Level 10000 should be the maximum
        // XP needed = 4500 + (9981 * 5000) = 49909500
        val level = SkyWarsStats.calculateLevel(49909500)
        assertEquals(10000.0, level, 0.01)
    }

    @Test
    fun `test beyond max level is capped`() {
        // XP beyond max level should still return 10000
        val level = SkyWarsStats.calculateLevel(100000000)
        assertEquals(10000.0, level, 0.01)
    }

    @Test
    fun `test prestige tier at level 0`() {
        val style = SkyWarsStats.getPrestigeStyle(0)
        assertEquals("Stone", style.name)
        assertEquals("7", style.colorCode)
    }

    @Test
    fun `test prestige tier at level 10`() {
        val style = SkyWarsStats.getPrestigeStyle(10)
        assertEquals("Iron", style.name)
        assertEquals("f", style.colorCode)
    }

    @Test
    fun `test prestige tier at level 50`() {
        val style = SkyWarsStats.getPrestigeStyle(50)
        assertEquals("Crystal", style.name)
        assertEquals("d", style.colorCode)
    }

    @Test
    fun `test prestige tier at level 100`() {
        val style = SkyWarsStats.getPrestigeStyle(100)
        assertEquals("Mythic", style.name)
        assertEquals("c", style.colorCode)
    }

    @Test
    fun `test prestige tier at level 200`() {
        val style = SkyWarsStats.getPrestigeStyle(200)
        assertEquals("Mythic II", style.name)
        assertEquals("e", style.colorCode)
    }

    @Test
    fun `test prestige tier at level 500`() {
        val style = SkyWarsStats.getPrestigeStyle(500)
        assertEquals("Mythic V", style.name)
        assertEquals("d", style.colorCode)
    }

    @Test
    fun `test prestige tier beyond 500`() {
        val style = SkyWarsStats.getPrestigeStyle(1000)
        assertEquals("Mythic V", style.name)
        assertEquals("d", style.colorCode)
    }

    @Test
    fun `test emblem at level 0`() {
        val emblem = SkyWarsStats.getDefaultEmblem(0)
        assertEquals("✯", emblem)
    }

    @Test
    fun `test emblem at level 50`() {
        val emblem = SkyWarsStats.getDefaultEmblem(50)
        assertEquals("^_^", emblem)
    }

    @Test
    fun `test emblem at level 100`() {
        val emblem = SkyWarsStats.getDefaultEmblem(100)
        assertEquals("@_@", emblem)
    }

    @Test
    fun `test emblem at level 500`() {
        val emblem = SkyWarsStats.getDefaultEmblem(500)
        assertEquals("༼つ◕_◕༽つ", emblem)
    }

    @Test
    fun `test level tag formatting`() {
        val tag = SkyWarsStats.formatLevelTag(100)
        assertEquals("§c[100@_@]", tag)
    }

    @Test
    fun `test level tag formatting for stone prestige`() {
        val tag = SkyWarsStats.formatLevelTag(5)
        assertEquals("§7[5✯]", tag)
    }

    @Test
    fun `test level tag formatting for gold prestige`() {
        val tag = SkyWarsStats.formatLevelTag(25)
        assertEquals("§6[25✯]", tag)
    }

    @Test
    fun `test KDR calculation with valid values`() {
        val kdr = SkyWarsStats.calculateKDR(100, 50)
        assertEquals(2.0, kdr, 0.01)
    }

    @Test
    fun `test KDR calculation with zero deaths`() {
        val kdr = SkyWarsStats.calculateKDR(100, 0)
        assertEquals(100.0, kdr, 0.01)
    }

    @Test
    fun `test KDR calculation with null values`() {
        val kdr = SkyWarsStats.calculateKDR(null, 50)
        assertNull(kdr)
    }

    @Test
    fun `test WLR calculation with valid values`() {
        val wlr = SkyWarsStats.calculateWLR(100, 50)
        assertEquals(2.0, wlr, 0.01)
    }

    @Test
    fun `test WLR calculation with zero losses`() {
        val wlr = SkyWarsStats.calculateWLR(100, 0)
        assertEquals(100.0, wlr, 0.01)
    }

    @Test
    fun `test cached stats levelInt property`() {
        val cached = CachedSkyWarsStats(
            level = 15.7,
            experience = 1000,
            wins = 100,
            losses = 50,
            kills = 500,
            deaths = 200,
            fetchedAt = System.currentTimeMillis()
        )
        assertEquals(15, cached.levelInt)
    }

    @Test
    fun `test cached stats with null level`() {
        val cached = CachedSkyWarsStats(
            level = null,
            experience = null,
            wins = null,
            losses = null,
            kills = null,
            deaths = null,
            fetchedAt = System.currentTimeMillis()
        )
        assertEquals(0, cached.levelInt)
    }

    @Test
    fun `test cached stats expiration`() {
        val now = System.currentTimeMillis()
        val cached = CachedSkyWarsStats(
            level = 100.0,
            experience = 100000,
            wins = 1000,
            losses = 500,
            kills = 5000,
            deaths = 2000,
            fetchedAt = now - 3600001 // 1 hour and 1 ms ago
        )
        assertTrue(cached.isExpired(3600000, now))
    }

    @Test
    fun `test cached stats not expired`() {
        val now = System.currentTimeMillis()
        val cached = CachedSkyWarsStats(
            level = 100.0,
            experience = 100000,
            wins = 1000,
            losses = 500,
            kills = 5000,
            deaths = 2000,
            fetchedAt = now - 1800000 // 30 minutes ago
        )
        assertFalse(cached.isExpired(3600000, now))
    }
}