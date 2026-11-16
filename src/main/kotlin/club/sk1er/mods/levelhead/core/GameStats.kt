package club.sk1er.mods.levelhead.core

import java.time.Duration

/**
 * Unified container for game statistics across all supported game modes.
 * Allows the caching system to handle BedWars, Duels, and SkyWars uniformly.
 */
sealed class GameStats {
    abstract val fetchedAt: Long
    abstract val nicked: Boolean

    /**
     * Check if the cached stats have expired based on the provided TTL.
     */
    abstract fun isExpired(ttl: Duration, now: Long = System.currentTimeMillis()): Boolean

    /**
     * BedWars statistics.
     */
    data class Bedwars(
        val star: Int?,
        val fkdr: Double?,
        override val nicked: Boolean,
        override val fetchedAt: Long,
        /** The glyph selected in the Prestige Customizer, or null for the level default. */
        val starIcon: String? = null
    ) : GameStats() {
        override fun isExpired(ttl: Duration, now: Long): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }
    }

    /**
     * Duels statistics.
     */
    data class Duels(
        val wins: Int?,
        val losses: Int?,
        val kills: Int?,
        val deaths: Int?,
        override val nicked: Boolean,
        override val fetchedAt: Long
    ) : GameStats() {
        override fun isExpired(ttl: Duration, now: Long): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }
    }

    /**
     * SkyWars statistics.
     * Level is stored as Double for precision but displayed as integer.
     */
    data class SkyWars(
        val level: Double?,
        val wins: Int?,
        val losses: Int?,
        val kills: Int?,
        val deaths: Int?,
        override val nicked: Boolean,
        override val fetchedAt: Long
    ) : GameStats() {
        override fun isExpired(ttl: Duration, now: Long): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }
    }
}
