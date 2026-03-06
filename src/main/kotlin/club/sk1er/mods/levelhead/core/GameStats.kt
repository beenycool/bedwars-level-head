package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.duels.CachedDuelsStats
import club.sk1er.mods.levelhead.skywars.CachedSkyWarsStats
import java.time.Duration

/**
 * Unified container for game statistics across all supported game modes.
 * Allows the caching system to handle BedWars, Duels, and SkyWars uniformly.
 */
sealed class GameStats {
    abstract val fetchedAt: Long
    abstract val etag: String?
    abstract val nicked: Boolean

    @Transient var cachedTabString: String? = null
    
    /**
     * Check if the cached stats have expired based on the provided TTL.
     */
    abstract fun isExpired(ttl: Duration, now: Long = System.currentTimeMillis()): Boolean
    
    /**
     * BedWars statistics.
     */
    data class Bedwars(
        val star: Int?,
        val experience: Long?,
        val fkdr: Double?,
        val winstreak: Int?,
        override val nicked: Boolean,
        override val fetchedAt: Long,
        override val etag: String? = null
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
        val winstreak: Int?,
        val bestWinstreak: Int?,
        override val nicked: Boolean,
        override val fetchedAt: Long,
        override val etag: String? = null
    ) : GameStats() {
        override fun isExpired(ttl: Duration, now: Long): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }
        
        fun toCachedDuelsStats(): CachedDuelsStats {
            return CachedDuelsStats(
                wins = wins,
                losses = losses,
                kills = kills,
                deaths = deaths,
                winstreak = winstreak,
                bestWinstreak = bestWinstreak,
                fetchedAt = fetchedAt,
                etag = etag
            )
        }
    }
    
    /**
     * SkyWars statistics.
     * Level is stored as Double for precision but displayed as integer.
     */
    data class SkyWars(
        val level: Double?,
        val experience: Long?,
        val wins: Int?,
        val losses: Int?,
        val kills: Int?,
        val deaths: Int?,
        override val nicked: Boolean,
        override val fetchedAt: Long,
        override val etag: String? = null
    ) : GameStats() {
        override fun isExpired(ttl: Duration, now: Long): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }

        /**
         * Integer version of level for display purposes.
         */
        val levelInt: Int get() = level?.toInt() ?: 0

        fun toCachedSkyWarsStats(): CachedSkyWarsStats {
            return CachedSkyWarsStats(
                level = level,
                experience = experience,
                wins = wins,
                losses = losses,
                kills = kills,
                deaths = deaths,
                fetchedAt = fetchedAt,
                etag = etag
            )
        }
    }
    
    companion object {
        /**
         * Create GameStats from CachedDuelsStats.
         */
        fun fromDuels(cached: CachedDuelsStats): Duels {
            return Duels(
                wins = cached.wins,
                losses = cached.losses,
                kills = cached.kills,
                deaths = cached.deaths,
                winstreak = cached.winstreak,
                bestWinstreak = cached.bestWinstreak,
                nicked = false,
                fetchedAt = cached.fetchedAt,
                etag = cached.etag
            )
        }
        
        /**
         * Create GameStats from CachedSkyWarsStats.
         */
        fun fromSkyWars(cached: CachedSkyWarsStats): SkyWars {
            return SkyWars(
                level = cached.level,
                experience = cached.experience,
                wins = cached.wins,
                losses = cached.losses,
                kills = cached.kills,
                deaths = cached.deaths,
                nicked = false,
                fetchedAt = cached.fetchedAt,
                etag = cached.etag
            )
        }
    }
}
