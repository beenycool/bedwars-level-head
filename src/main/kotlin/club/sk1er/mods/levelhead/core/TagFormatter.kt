package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.display.LevelheadTag
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Memoised tag derivation.
 *
 * A tag is a pure function of (stats, settings, mode). The mod used to store the
 * result per display, which meant every settings or stats change needed a manual
 * invalidation call somewhere. This cache is keyed by the versions of those inputs
 * instead: a new stats value or a settings save produces a different key, so a
 * stale tag can never be served.
 *
 * [StatsFormatter] remains the formatting core; this class only decides when to
 * call it. The memo is intentionally process-wide (nametag and tab share the same
 * text for the same inputs) and bounded.
 */
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

    /**
     * Called whenever a setting changes. OneConfig writes GUI edits into fields and
     * then calls `LevelheadConfig.save()`, which routes here.
     */
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
