package club.sk1er.mods.levelhead

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The update check used to compare strings exactly against Modrinth's
 * `version_number`, so any naming difference (a leading "v", a suffix) produced a
 * permanent nag. These cases pin the tolerant comparison.
 */
class VersionComparisonTest {

    @Test
    fun `only a genuinely newer remote version nags`() {
        val cases = listOf(
            // remote, local, expected
            Triple("8.3.0", "8.3.0", false),
            Triple("v8.3.0", "8.3.0", false),
            Triple("8.3.0+forge", "8.3.0", false),
            Triple("8.3.0", "v8.3.0", false),
            Triple("8.2.9", "8.3.0", false),
            Triple("8.3", "8.3.1", false),
            Triple("8.3.1", "8.3.0", true),
            Triple("v9.0.0", "8.3.0", true),
            Triple("8.10.0", "8.9.0", true),
        )

        cases.forEach { (remote, local, expected) ->
            assertEqualsBool(
                expected,
                Levelhead.isRemoteVersionNewer(remote, local),
                "case: remote=$remote, local=$local",
            )
        }
    }

    @Test
    fun `unparseable versions never nag`() {
        assertFalse(
            Levelhead.isRemoteVersionNewer("latest", "8.3.0"),
            "case: unparseable remote",
        )
        assertFalse(
            Levelhead.isRemoteVersionNewer("8.3.0", "local"),
            "case: unparseable local",
        )
    }

    private fun assertEqualsBool(expected: Boolean, actual: Boolean, message: String) {
        if (expected) assertTrue(actual, message) else assertFalse(actual, message)
    }
}
