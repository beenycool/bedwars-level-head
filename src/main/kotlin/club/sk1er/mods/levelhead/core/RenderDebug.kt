package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import java.util.concurrent.ConcurrentHashMap

/**
 * Transition-gated render tracing. Tag lines are deduplicated by key and
 * signature and hard-capped per second; gate lines only fire when the gate
 * state changes. Enabling this cannot reproduce the old per-frame log flood.
 */
object RenderDebug {

    private const val REPEAT_INTERVAL_MS = 30_000L
    private const val CHANGE_COOLDOWN_MS = 250L
    private const val MAX_LINES_PER_SECOND = 6
    private const val MAX_KEYS = 256
    private const val KEY_TTL_MS = 60_000L

    private class Entry(val signature: String, val at: Long)

    private val last = ConcurrentHashMap<String, Entry>()
    private val lock = Any()
    private var windowStart = 0L
    private var windowCount = 0

    fun logTag(key: String, signature: String, message: () -> String) {
        if (!LevelheadConfig.debugRequests) return
        val now = System.currentTimeMillis()
        val previous = last[key]
        if (previous != null) {
            val changed = previous.signature != signature
            if (!changed && now - previous.at < REPEAT_INTERVAL_MS) return
            if (changed && now - previous.at < CHANGE_COOLDOWN_MS) return
        }
        emit(key, signature, now, message)
    }

    fun logGate(gate: String, signature: String, message: () -> String) {
        if (!LevelheadConfig.debugRequests) return
        val key = "gate:$gate"
        val previous = last[key]
        if (previous != null && previous.signature == signature) return
        emit(key, signature, System.currentTimeMillis(), message)
    }

    private fun emit(key: String, signature: String, now: Long, message: () -> String) {
        if (!allowLine(now)) return
        last[key] = Entry(signature, now)
        if (last.size > MAX_KEYS) {
            last.entries.removeIf { now - it.value.at > KEY_TTL_MS }
        }
        Levelhead.logger.info("[LevelheadRender] ${message()}")
    }

    private fun allowLine(now: Long): Boolean = synchronized(lock) {
        if (now - windowStart >= 1000L) {
            windowStart = now
            windowCount = 0
        }
        if (windowCount >= MAX_LINES_PER_SECOND) return false
        windowCount++
        true
    }
}
