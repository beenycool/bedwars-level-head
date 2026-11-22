package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

object DebugLogging {

    fun isRequestDebugEnabled(): Boolean = LevelheadConfig.debugRequests

    /**
     * Mask a UUID for privacy-safe logging.
     * Keeps only the last 4 characters, e.g., "****-abcd".
     */
    fun UUID.maskForLogs(): String {
        val uuidString = toString()
        val lastFour = uuidString.takeLast(4)
        return "****-$lastFour"
    }

    /** Canonical UUID patterns shared with ProxyClient. */
    internal val UUID_REGEX = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    internal val TRIMMED_UUID_REGEX = Regex("^[0-9a-fA-F]{32}$")

    fun String.maskIfUuid(): String {
        if (UUID_REGEX.matches(this) || TRIMMED_UUID_REGEX.matches(this)) {
            val lastFour = takeLast(4)
            return "****-$lastFour"
        }
        return this
    }

    /**
     * Request tracing only. Never call this from a render loop: one line per player
     * per frame is thousands of synchronous log writes per second on the client thread.
     */
    fun logRequestDebug(message: () -> String) {
        if (isRequestDebugEnabled()) {
            Levelhead.logger.info(message())
        }
    }
}

object DebugSession {
    const val SESSION_HEADER = "X-Levelhead-Session"

    private const val NO_SESSION = "none"
    private val counters = ConcurrentHashMap<String, AtomicInteger>()

    @Volatile
    private var currentId: String = NO_SESSION

    @Volatile
    private var startedAt: Long = 0L

    val id: String
        get() = currentId

    fun prefix(): String = "session=$currentId"

    fun start(reason: String) {
        if (currentId != NO_SESSION) {
            stop("superseded:$reason")
        }
        currentId = UUID.randomUUID().toString().take(8)
        startedAt = System.currentTimeMillis()
        counters.clear()
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][session] start ${prefix()} reason=$reason"
        }
    }

    fun stop(reason: String) {
        if (currentId == NO_SESSION) {
            return
        }
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][session] stop ${prefix()} reason=$reason uptime=${uptimeSeconds()}s ${snapshot()}"
        }
        currentId = NO_SESSION
        startedAt = 0L
    }

    fun inc(key: String, amount: Int = 1) {
        if (amount == 0) {
            return
        }
        counters.computeIfAbsent(key) { AtomicInteger(0) }.addAndGet(amount)
    }

    fun snapshot(): String {
        if (counters.isEmpty()) {
            return "counters={}"
        }
        return counters.entries
            .sortedBy { it.key }
            .joinToString(separator = ",", prefix = "counters={", postfix = "}") {
                "${it.key}=${it.value.get()}"
            }
    }

    fun summary(extra: String = ""): String {
        val suffix = if (extra.isBlank()) "" else " $extra"
        return "${prefix()} uptime=${uptimeSeconds()}s ${snapshot()}$suffix"
    }

    private fun uptimeSeconds(): Long =
        if (startedAt == 0L) 0L else (System.currentTimeMillis() - startedAt) / 1000L
}
