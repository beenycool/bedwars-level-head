package club.sk1er.mods.levelhead.contract

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.StatsFormatter
import club.sk1er.mods.levelhead.core.StatsPayloadParser
import club.sk1er.mods.levelhead.duels.DuelsFetcher
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsFetcher
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

/**
 * Mod side of the shared `contract/player-stats.json` fixture.
 *
 * The upstream payload is parsed by the real per-game fetcher (the same code path
 * `StatsStore` uses), and the expected footer is produced by the real
 * per-mode formatting code. If either side of the shape changes, one of these
 * assertions fails even if both repositories change together in the same PR.
 *
 * Limitation: `StatsFormatter.formatTag` calls `LevelheadConfig.footerTemplateFor`,
 * which forces the OneConfig-backed `LevelheadConfig` object to initialise. That is
 * impossible headless (OneConfig's runtime classes are not on the test classpath),
 * so this test drives the per-mode formatter functions directly and reconstructs
 * the default header from [GameMode.defaultHeader]. The header/colour wiring in
 * `formatTag` itself needs the config round-trip test that is also blocked (see the
 * review notes).
 */
class PlayerStatsContractTest {

    private fun buildStats(mode: GameMode, payload: JsonObject): GameStats? = when (mode) {
        GameMode.BEDWARS -> BedwarsFetcher.buildStats(payload, null)
        GameMode.DUELS -> DuelsFetcher.buildStats(payload, null)
        GameMode.SKYWARS -> SkyWarsFetcher.buildStats(payload, null)
    }

    @Test
    fun `every fixture upstream parses into the stats the backend says it emits`() {
        ContractFixture.cases.forEach { contractCase ->
            assertNotNull(
                StatsPayloadParser.findStatsObject(contractCase.upstream, contractCase.mode),
                "${contractCase.mode} fixture upstream must expose a stats object",
            )

            val stats = buildStats(contractCase.mode, contractCase.upstream)
            assertNotNull(stats, "${contractCase.mode} fixture did not parse")
            assertStatsMatch(contractCase, stats!!)

            assertEquals(
                ContractFixture.string(contractCase.minimalStats, "displayname"),
                contractCase.upstream.getAsJsonObject("player").get("displayname").asString,
            )
        }
    }

    @Test
    fun `the backend minimal payload parses back into the same stats`() {
        // This is the shape the mod actually receives from POST /batch: the flat
        // MinimalPlayerStats object plus `nicked`, not the Hypixel envelope above.
        ContractFixture.cases.forEach { contractCase ->
            val emitted = contractCase.minimalStats.deepCopy().apply { addProperty("nicked", false) }

            assertNotNull(
                StatsPayloadParser.findStatsObject(emitted, contractCase.mode),
                "${contractCase.mode} backend payload must expose a stats object",
            )

            val stats = buildStats(contractCase.mode, emitted)
            assertNotNull(stats, "${contractCase.mode} backend payload did not parse")
            assertStatsMatch(contractCase, stats!!)
        }
    }

    private fun assertStatsMatch(contractCase: ContractFixture.Case, stats: GameStats) {
        assertFalse(stats.nicked, "${contractCase.mode} fixture must not look nicked")

        when (stats) {
            is GameStats.Bedwars -> {
                val experience = ContractFixture.long(contractCase.minimalStats, "bedwars_experience")
                assertEquals(BedwarsStar.calculateStar(experience), stats.star)

                val kills = ContractFixture.int(contractCase.minimalStats, "bedwars_final_kills")
                val deaths = ContractFixture.int(contractCase.minimalStats, "bedwars_final_deaths")
                val expectedFkdr = if (deaths <= 0) kills.toDouble() else kills.toDouble() / deaths
                assertEquals(expectedFkdr, stats.fkdr ?: Double.NaN, 1e-9)
            }

            is GameStats.Duels -> {
                assertEquals(ContractFixture.int(contractCase.minimalStats, "duels_wins"), stats.wins)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "duels_losses"), stats.losses)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "duels_kills"), stats.kills)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "duels_deaths"), stats.deaths)
            }

            is GameStats.SkyWars -> {
                val experience = ContractFixture.long(contractCase.minimalStats, "skywars_experience")
                assertEquals(SkyWarsStats.calculateLevel(experience), stats.level ?: Double.NaN, 1e-9)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "skywars_wins"), stats.wins)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "skywars_losses"), stats.losses)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "skywars_kills"), stats.kills)
                assertEquals(ContractFixture.int(contractCase.minimalStats, "skywars_deaths"), stats.deaths)
            }
        }
    }

    @Test
    fun `every fixture renders its literal footer and tag`() {
        ContractFixture.cases.forEach { contractCase ->
            val stats = requireNotNull(buildStats(contractCase.mode, contractCase.upstream)) {
                "${contractCase.mode} fixture did not parse"
            }
            val footer = formattedFooter(contractCase.mode, stats)

            // The literal, including every § code. This is the assertion that fails on
            // a colour, emblem, icon or division-format drift.
            assertEquals(contractCase.expectedFooter, footer, "footer drifted for ${contractCase.mode}")
            assertEquals(
                "${contractCase.mode.defaultHeader}: ",
                contractCase.expectedTag.removeSuffix(contractCase.expectedFooter),
                "the fixture tag must be the default header plus the formatted footer",
            )
            assertEquals(
                "${contractCase.mode.defaultHeader}: $footer",
                contractCase.expectedTag,
                "tag drifted for ${contractCase.mode}",
            )
        }
    }

    /**
     * Uses the production formatter for BedWars and SkyWars. Duels is reconstructed
     * from `DuelsStats` because `formatDuelsStats` reads `LevelheadConfig` even when
     * the tag is already formatted (see the class comment).
     */
    private fun formattedFooter(mode: GameMode, stats: GameStats): String {
        if (mode == GameMode.DUELS) {
            val duels = stats as GameStats.Duels
            val division = DuelsStats.getOverallDivisionInfo(requireNotNull(duels.wins))
            return if (division.bold) "§l${division.displayName}" else division.displayName
        }

        val methodName = when (mode) {
            GameMode.BEDWARS -> "formatBedwarsStats"
            GameMode.SKYWARS -> "formatSkyWarsStats"
            GameMode.DUELS -> error("handled above")
        }
        val template = "%star%"
        val method = StatsFormatter::class.java.getDeclaredMethod(
            methodName,
            stats.javaClass,
            String::class.java,
            DisplayConfig::class.java,
        )
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val result = method.invoke(StatsFormatter, stats, template, DisplayConfig()) as Pair<String, *>
        return result.first
    }
}
