package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsHttpUtils.sanitizeForLogs
import club.sk1er.mods.levelhead.config.LevelheadConfig
import java.awt.Color
import java.util.Locale
import java.util.UUID

/**
 * Shared debug logging helpers for the Levelhead mod.
 * Provides allocation-light utilities for conditional logging, formatting, and redaction.
 */
object DebugLogging {

    /**
     * Check if request debug logging is enabled.
     * Use this before building any debug log strings.
     */
    fun isRequestDebugEnabled(): Boolean = LevelheadConfig.debugRequests

    /**
     * Check if render sampling debug logging is enabled.
     * Use this before building any debug log strings.
     */
    fun isRenderDebugEnabled(): Boolean = LevelheadConfig.debugRenderSampling

    /**
     * Format a Color as a hex string (#RRGGBB).
     * Returns uppercase hex for consistency.
     */
    fun Color.formatAsHex(): String {
        return String.format(Locale.ROOT, "#%02X%02X%02X", red, green, blue)
    }

    /**
     * Truncate a string safely, handling special characters like § and ✪.
     * Will not split multi-byte characters in the middle.
     * If the string is truncated, appends "..." to indicate truncation.
     *
     * @param maxLength Maximum length including the ellipsis
     * @return The truncated string, or original if within limit
     */
    fun String.truncateForLogs(maxLength: Int): String {
        if (maxLength <= 3) return "..."
        if (length <= maxLength) return this

        // Find a safe cutoff point that doesn't split special characters
        // § is 2 bytes in UTF-8, ✪ is 3 bytes, but in Kotlin String they're each 1 char
        // We just need to ensure we don't cut in the middle of visible text
        val effectiveMax = maxLength - 3
        var cutoff = effectiveMax

        // Avoid leaving a dangling color code character at the end of the truncated string.
        while (cutoff > 0 && (this[cutoff - 1] == '§' || this[cutoff - 1] == '✪')) {
            cutoff--
        }

        return if (cutoff > 0) {
            substring(0, cutoff) + "..."
        } else {
            "..."
        }
    }

    /**
     * Mask a UUID for privacy-safe logging.
     * Keeps only the last 4 characters, e.g., "****-abcd".
     */
    fun UUID.maskForLogs(): String {
        val uuidString = toString()
        val lastFour = uuidString.takeLast(4)
        return "****-$lastFour"
    }

    private val UUID_REGEX = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val TRIMMED_UUID_REGEX = Regex("^[0-9a-fA-F]{32}$")

    /**
     * Mask a string as UUID for privacy-safe logging.
     * Useful when you have a string that might be a UUID.
     * Returns original if not a valid UUID format.
     */
    fun String.maskIfUuid(): String {
        if (UUID_REGEX.matches(this) || TRIMMED_UUID_REGEX.matches(this)) {
            val lastFour = takeLast(4)
            return "****-$lastFour"
        }
        return this
    }

    /**
     * Conditionally log a request debug message.
     * Only builds the message string if debug is enabled.
     */
    fun logRequestDebug(message: () -> String) {
        if (isRequestDebugEnabled()) {
            Levelhead.logger.info("[DEBUG-REQ] " + message())
        }
    }

    /**
     * Conditionally log a render debug message.
     * Only builds the message string if debug is enabled.
     */
    fun logRenderDebug(message: () -> String) {
        if (isRenderDebugEnabled()) {
            Levelhead.logger.info("[DEBUG-RENDER] " + message())
        }
    }

    /**
     * Format and sanitize a URL or body for logging.
     * Redacts secrets and truncates to a reasonable length.
     */
    fun String.sanitizeAndTruncateForLogs(maxLength: Int = 200): String {
        return sanitizeForLogs().truncateForLogs(maxLength)
    }
}
