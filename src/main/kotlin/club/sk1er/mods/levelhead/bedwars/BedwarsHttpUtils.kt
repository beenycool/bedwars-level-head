package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object BedwarsHttpUtils {
    // Regex patterns for sanitizing logs - compiled once for performance
    private val KEY_TOKEN_REGEX = Regex("""(?i)(key|token)=([^&\s]+)""")
    private val JSON_KEY_TOKEN_REGEX = Regex("""(?i)"(key|token|api_key|apikey)"\s*:\s*"([^"]+)"""")
    private val AUTHORIZATION_BEARER_REGEX = Regex("""(?i)(authorization\s*:\s*bearer\s+)([^\s"]+)""")

    fun String.sanitizeForLogs(): String {
        if (isEmpty()) return this
        var sanitized = this
        listOf(LevelheadConfig.apiKey, LevelheadConfig.proxyAuthToken, LevelheadConfig.installId)
            .filter { it.isNotBlank() }
            .forEach { secret ->
                sanitized = sanitized.replace(secret, "***")
            }
        sanitized = sanitized.replace(KEY_TOKEN_REGEX) { matchResult ->
            "${matchResult.groupValues[1]}=***"
        }
        sanitized = sanitized.replace(JSON_KEY_TOKEN_REGEX) { matchResult ->
            "\"${matchResult.groupValues[1]}\":\"***\""
        }
        sanitized = sanitized.replace(AUTHORIZATION_BEARER_REGEX) { matchResult ->
            "${matchResult.groupValues[1]}***"
        }
        return sanitized
    }

    suspend fun executeWithRetries(request: Request, description: String, attempts: Int = 2): Response {
        var lastException: IOException? = null
        repeat(attempts) { index ->
            try {
                return Levelhead.okHttpClient.newCall(request).execute()
            } catch (ex: IOException) {
                if (!isTimeout(ex)) {
                    throw ex
                }
                lastException = ex
                val remainingAttempts = attempts - index - 1
                if (remainingAttempts > 0) {
                    val backoffMillis = 250L * (index + 1)
                    Levelhead.logger.warn(
                        "Timed out {} request (attempt {}/{}). Retrying in {} ms.",
                        description,
                        index + 1,
                        attempts,
                        backoffMillis
                    )
                    kotlinx.coroutines.delay(backoffMillis)
                }
            }
        }
        throw lastException ?: IOException("Request failed for $description")
    }

    private fun isTimeout(error: IOException): Boolean {
        if (error is SocketTimeoutException) return true
        return error is InterruptedIOException && error.message?.contains("timeout", ignoreCase = true) == true
    }

    fun handleRetryAfterHint(source: String, retryAfterMillis: Long?, silent: Boolean = false) {
        val millis = retryAfterMillis ?: return
        if (millis <= 0) return
        Levelhead.logger.info("Received Retry-After hint from {} for {} ms (silent=$silent)", source, millis)
        Levelhead.rateLimiter.registerServerCooldown(Duration.ofMillis(millis), silent)
    }

    fun parseRetryAfterMillis(value: String?): Long? {
        val raw = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        raw.toLongOrNull()?.let { seconds ->
            return if (seconds < 0) null else seconds * 1000L
        }
        raw.toDoubleOrNull()?.let { seconds ->
            return if (seconds < 0) null else (seconds * 1000.0).toLong()
        }

        return kotlin.runCatching {
            val targetInstant = ZonedDateTime.parse(raw, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
            val now = Instant.now()
            val millis = Duration.between(now, targetInstant).toMillis()
            if (millis <= 0) null else millis
        }.getOrNull()
    }
    
    fun Long.toHttpDateString(): String {
        return DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(this))
    }
}
