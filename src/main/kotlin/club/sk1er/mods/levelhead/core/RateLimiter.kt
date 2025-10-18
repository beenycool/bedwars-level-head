package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
    data class Metrics(val remaining: Int, val resetIn: Duration, val serverCooldown: Duration?)

    private val mutex: Mutex = Mutex()

    private var count: Int = 0
    private var nextInterval: Instant = Instant.ofEpochMilli(0)
    @Volatile
    private var latestMetrics: Metrics = Metrics(capacity, Duration.ZERO, null)
    private var serverCooldownUntil: Instant? = null

    private val isNextInterval: Boolean
        get() = nextInterval <= clock.instant()
    private val isAtCapacity: Boolean
        get() = count == capacity

    fun resetState() {
        count = 0
        nextInterval = clock.instant() + interval
        serverCooldownUntil = null
        Levelhead.displayManager.checkCacheSizes()
        Levelhead.resetRateLimiterNotification()
        Levelhead.resetServerCooldownNotification()
        updateMetrics()
    }

    private suspend fun delayUntilNextInterval() {
        val delay = Duration.between(clock.instant(), nextInterval)
        delay(delay.toKotlinDuration())
    }

    private fun metricsLocked(now: Instant = clock.instant()): Metrics {
        val remaining = capacity - count
        val resetIn = if (nextInterval.isBefore(now)) Duration.ZERO else Duration.between(now, nextInterval)
        val cooldown = serverCooldownUntil?.let { hint ->
            if (now.isBefore(hint)) {
                Duration.between(now, hint)
            } else {
                serverCooldownUntil = null
                null
            }
        }
        val sanitizedCooldown = cooldown?.takeIf { !it.isZero && !it.isNegative }
        return Metrics(remaining, resetIn, sanitizedCooldown)
    }

    private fun updateMetrics(now: Instant = clock.instant()) {
        latestMetrics = metricsLocked(now)
    }

    suspend fun consume() = mutex.withLock {
        loop@ while (true) {
            val now = clock.instant()

            val cooldownHint = serverCooldownUntil
            if (cooldownHint != null) {
                if (now.isBefore(cooldownHint)) {
                    val wait = Duration.between(now, cooldownHint)
                    Levelhead.logger.info(
                        "Respecting server Retry-After hint for ${wait.seconds} seconds before issuing more BedWars requests."
                    )
                    delay(wait.toKotlinDuration())
                    serverCooldownUntil = null
                    resetState()
                    continue@loop
                } else {
                    serverCooldownUntil = null
                }
            }

            if (isNextInterval) {
                resetState()
                continue@loop
            }

            if (isAtCapacity) {
                val metrics = metricsLocked(now)
                val safeWait = metrics.resetIn
                Levelhead.logger.info(
                    "Reached Levelhead API throttle (150 requests per 5 minutes). Waiting ${safeWait.toMinutes()} minutes (${safeWait.seconds} seconds) before retrying."
                )
                Levelhead.onRateLimiterBlocked(metrics)
                delayUntilNextInterval()
                resetState()
                continue@loop
            }

            count++
            updateMetrics(now)
            return@withLock
        }
    }

    fun metricsSnapshot(): Metrics = latestMetrics

    fun registerServerCooldown(duration: Duration) {
        if (duration.isZero || duration.isNegative) return
        val sanitized = duration
        Levelhead.scope.launch {
            var applied = false
            mutex.withLock {
                val now = clock.instant()
                val target = now + sanitized
                val currentHint = serverCooldownUntil
                if (currentHint == null || currentHint.isBefore(target)) {
                    serverCooldownUntil = target
                    if (nextInterval.isBefore(target)) {
                        nextInterval = target
                    }
                    updateMetrics(now)
                    applied = true
                }
            }
            if (applied) {
                Levelhead.logger.info(
                    "Server requested cooldown for ${sanitized.seconds} seconds via Retry-After."
                )
                Levelhead.onServerRetryAfter(sanitized)
            }
        }
    }
}
