package club.sk1er.mods.levelhead.bedwars

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

class BedwarsHttpUtilsTest {

    @Test
    fun `parseRetryAfterMillis handles null input`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis(null)
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis handles empty string`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("")
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis handles blank string`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("   ")
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis parses numeric seconds`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("30")
        assertEquals(30000L, result)
    }

    @Test
    fun `parseRetryAfterMillis parses double seconds`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("1.5")
        assertEquals(1500L, result)
    }

    @Test
    fun `parseRetryAfterMillis handles zero seconds`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("0")
        assertEquals(0L, result)
    }

    @Test
    fun `parseRetryAfterMillis handles small decimal seconds`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("0.5")
        assertEquals(500L, result)
    }

    @Test
    fun `parseRetryAfterMillis returns null for negative seconds`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("-10")
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis returns null for negative double seconds`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("-5.5")
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis parses RFC1123 future date`() {
        // Generate a date 30 seconds in the future
        val futureInstant = Instant.now().plusSeconds(30)
        val futureDate = DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(futureInstant)

        val result = BedwarsHttpUtils.parseRetryAfterMillis(futureDate)

        assertNotNull(result)
        // Result should be approximately 30 seconds (30000ms), allow some tolerance
        assertTrue(result!! in 25000..35000)
    }

    @Test
    fun `parseRetryAfterMillis returns null for past RFC1123 date`() {
        // Generate a date 30 seconds in the past
        val pastInstant = Instant.now().minusSeconds(30)
        val pastDate = DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(pastInstant)

        val result = BedwarsHttpUtils.parseRetryAfterMillis(pastDate)

        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis handles large numeric values`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("3600")
        assertEquals(3600000L, result) // 1 hour in milliseconds
    }

    @Test
    fun `parseRetryAfterMillis handles whitespace in input`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("  30  ")
        assertEquals(30000L, result)
    }

    @Test
    fun `parseRetryAfterMillis handles whitespace around RFC1123 date`() {
        // Generate a date 30 seconds in the future
        val futureInstant = Instant.now().plusSeconds(30)
        val futureDate = DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(futureInstant)

        val result = BedwarsHttpUtils.parseRetryAfterMillis("  $futureDate  ")

        assertNotNull(result)
    }

    @Test
    fun `parseRetryAfterMillis handles invalid format`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("not-a-number")
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis handles mixed invalid format`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("30abc")
        assertNull(result)
    }

    @Test
    fun `parseRetryAfterMillis handles scientific notation`() {
        val result = BedwarsHttpUtils.parseRetryAfterMillis("1e3")
        // toDoubleOrNull should parse this as 1000.0
        assertEquals(1000000L, result) // 1e3 * 1000 = 1000000ms = 1000 seconds
    }
}
