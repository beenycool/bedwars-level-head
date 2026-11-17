package club.sk1er.mods.levelhead.core

import java.time.Duration

sealed class GameStats {
    abstract val fetchedAt: Long
    abstract val nicked: Boolean

    abstract fun isExpired(ttl: Duration, now: Long = System.currentTimeMillis()): Boolean

    data class Bedwars(
        val star: Int?,
        val fkdr: Double?,
        override val nicked: Boolean,
        override val fetchedAt: Long,
        val starIcon: String? = null
    ) : GameStats() {
        override fun isExpired(ttl: Duration, now: Long): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }
    }

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
