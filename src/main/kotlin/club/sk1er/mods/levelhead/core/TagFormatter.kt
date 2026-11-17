package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.display.LevelheadTag
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

object TagFormatter {
    private data class Key(
        val uuid: UUID,
        val statsVersion: Long,
        val configVersion: Long,
        val gameMode: GameMode,
        val config: DisplayConfig
    )

    private val memo = ConcurrentHashMap<Key, LevelheadTag>()
    private val settingsVersion = AtomicLong(0L)

    fun invalidate() {
        settingsVersion.incrementAndGet()
        memo.clear()
    }

    fun formatTag(
        uuid: UUID,
        stats: GameStats,
        config: DisplayConfig,
        gameMode: GameMode,
        statsVersion: Long = stats.fetchedAt,
        configVersion: Long = settingsVersion.get()
    ): LevelheadTag {
        val key = Key(uuid, statsVersion, configVersion, gameMode, config)
        memo[key]?.let { return it }

        val tag = StatsFormatter.formatTag(uuid, stats, config, gameMode)
        if (memo.size >= MAX_ENTRIES) {
            memo.clear()
        }
        memo[key] = tag
        return tag
    }

    private const val MAX_ENTRIES = 4096
}
