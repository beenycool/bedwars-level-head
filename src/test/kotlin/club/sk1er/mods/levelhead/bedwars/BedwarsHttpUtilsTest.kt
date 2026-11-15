package club.sk1er.mods.levelhead.bedwars

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * `parseRetryAfterMillis` accepts the three shapes a Retry-After header can take:
 * delta-seconds (integer or decimal), an HTTP-date, and nothing at all. The tables
 * below keep every original input; the assertion message names the failing value.
 */
class BedwarsHttpUtilsTest {

    @Test
    fun `absent or blank headers are absence, not a cooldown`() {
        val cases = listOf<Pair<String?, String>>(
            null to "null",
            "" to "empty string",
            "   " to "blank string",
        )

        cases.forEach { (value, name) ->
            assertNull(BedwarsHttpUtils.parseRetryAfterMillis(value), "case: $name")
        }
    }

    @Test
    fun `numeric seconds are converted to milliseconds`() {
        val cases = listOf(
            Triple("30", 30_000L, "integer seconds"),
            Triple("1.5", 1_500L, "decimal seconds"),
            Triple("0", 0L, "zero seconds"),
            Triple("0.5", 500L, "small decimal seconds"),
            Triple("3600", 3_600_000L, "large value / one hour"),
            Triple("  30  ", 30_000L, "whitespace around integer"),
            Triple("1e3", 1_000_000L, "scientific notation"),
        )

        cases.forEach { (header, expected, name) ->
            assertEquals(expected, BedwarsHttpUtils.parseRetryAfterMillis(header), "case: $name ($header)")
        }
    }

    @Test
    fun `negative or unparseable values are rejected`() {
        val cases = listOf(
            "-10" to "negative integer",
            "-5.5" to "negative decimal",
            "not-a-number" to "invalid text",
            "30abc" to "trailing garbage",
        )

        cases.forEach { (header, name) ->
            assertNull(BedwarsHttpUtils.parseRetryAfterMillis(header), "case: $name ($header)")
        }
    }

    @Test
    fun `HTTP dates are converted relative to now`() {
        val futureDate = DateTimeFormatter.RFC_1123_DATE_TIME
            .withZone(ZoneOffset.UTC)
            .format(Instant.now().plusSeconds(30))

        val future = BedwarsHttpUtils.parseRetryAfterMillis(futureDate)
        assertNotNull(future, "case: RFC1123 date 30s in the future ($futureDate)")
        // Approximately 30 seconds (30000ms); allow a little scheduling tolerance.
        assertTrue(future in 25_000L..35_000L, "case: future date must be ~30s, was ${future}ms")

        val pastDate = DateTimeFormatter.RFC_1123_DATE_TIME
            .withZone(ZoneOffset.UTC)
            .format(Instant.now().minusSeconds(30))
        assertNull(
            BedwarsHttpUtils.parseRetryAfterMillis(pastDate),
            "case: RFC1123 date 30s in the past ($pastDate)",
        )

        assertNotNull(
            BedwarsHttpUtils.parseRetryAfterMillis("  $futureDate  "),
            "case: RFC1123 date with surrounding whitespace ($futureDate)",
        )
    }
}
