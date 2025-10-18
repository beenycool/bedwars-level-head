package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Clock
import java.time.Instant
import java.time.Duration
import kotlin.time.ExperimentalTime
import kotlin.time.toKotlinDuration

/**
 * Based on [BucketRateLimiter.kt] from kord
 * Licensed under MIT License
 * https://github.com/kordlib/kord/blob/0.8.x/common/src/main/kotlin/ratelimit/BucketRateLimiter.kt
 */
@OptIn(ExperimentalTime::class)
class RateLimiter constructor(
    private val capacity: Int,
    private val interval: Duration,
    private val clock: Clock = Clock.systemDefaultZone()
) {
    data class Metrics(val remaining: Int, val resetIn: Duration)

    private val mutex: Mutex = Mutex()

    private var count: Int = 0
    private var nextInterval: Instant = Instant.ofEpochMilli(0)
    @Volatile
    private var latestMetrics: Metrics = Metrics(capacity, Duration.ZERO)

    private val isNextInterval: Boolean
        get() = nextInterval <= clock.instant()
    private val isAtCapacity: Boolean
        get() = count == capacity

    fun resetState() {
        count = 0
        nextInterval = clock.instant() + interval
        Levelhead.displayManager.checkCacheSizes()
        Levelhead.resetRateLimiterNotification()
        updateMetrics()
    }

    private suspend fun delayUntilNextInterval() {
        val delay = Duration.between(clock.instant(), nextInterval)
        delay(delay.toKotlinDuration())
    }

    private fun metricsLocked(now: Instant = clock.instant()): Metrics {
        val remaining = capacity - count
        val resetIn = if (nextInterval.isBefore(now)) Duration.ZERO else Duration.between(now, nextInterval)
        return Metrics(remaining, resetIn)
    }

    private fun updateMetrics(now: Instant = clock.instant()) {
        latestMetrics = metricsLocked(now)
    }

    suspend fun consume() = mutex.withLock {
        if (isNextInterval) resetState()

        if (isAtCapacity) {
            val now = clock.instant()
            val metrics = metricsLocked(now)
            val safeWait = metrics.resetIn
            Levelhead.logger.info(
                "Reached Levelhead API throttle (150 requests per 5 minutes). Waiting ${safeWait.toMinutes()} minutes (${safeWait.seconds} seconds) before retrying."
            )
            Levelhead.onRateLimiterBlocked(metrics)
            delayUntilNextInterval()
            resetState()
        }

        count++
        updateMetrics()
    }

    fun metricsSnapshot(): Metrics = latestMetrics
}