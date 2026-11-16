package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.duels.DuelsFetcher
import club.sk1er.mods.levelhead.skywars.SkyWarsFetcher
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Golden strings for the BedWars star tag, which the nametag and tab list share.
 *
 * These are the pure inputs to `StatsFormatter.formatBedwarsStats`. The shared
 * contract fixture is parsed and formatted by `PlayerStatsContractTest`; the one
 * piece that cannot be exercised headless is `StatsFormatter.formatTag` itself,
 * because it initialises the OneConfig-backed `LevelheadConfig`.
 */
class TagFormatterTest {

    @Test
    fun `rainbow prestiges use the multicolour colormap and filled star from 1000`() {
        // 1000-1099 is the rainbow prestige. Every character is coloured from the
        // 7-character colormap, including the tails; the icon is the filled star.
        assertEquals("§c[§61§e0§a5§b0§d✪§5]", BedwarsStar.formatStarTag(1050))
        assertEquals("§c[§61§e0§a9§b9§d✪§5]", BedwarsStar.formatStarTag(1099))
        // Matches the tag Hypixel showed for a 1063-star player in chat.
        assertEquals("§c[§61§e0§a6§b3§d✪§5]", BedwarsStar.formatStarTag(1063))
    }

    @Test
    fun `the star icon changes every 1000 stars`() {
        assertEquals("✫", BedwarsStar.getPrestigeIcon(999))
        assertEquals("✪", BedwarsStar.getPrestigeIcon(1000))
        assertEquals(
            "§7[§f1§f1§f0§f0§7✪§7]",
            BedwarsStar.formatStarTag(1100),
            "1100 starts the Iron Prime colormap and keeps the filled star",
        )

        // The later icon boundaries are also part of the tag contract.
        assertEquals("✪", BedwarsStar.getPrestigeIcon(1999))
        assertEquals("⚝", BedwarsStar.getPrestigeIcon(2000))
        assertEquals("⚝", BedwarsStar.getPrestigeIcon(2999))
        assertEquals("✥", BedwarsStar.getPrestigeIcon(3000))
        assertEquals("✥", BedwarsStar.getPrestigeIcon(3999))
        assertEquals("✭", BedwarsStar.getPrestigeIcon(4000))
    }

    @Test
    fun `prestige customizer stars override the level default`() {
        assertEquals("✫", BedwarsStar.iconForCosmetic("star_black_open"))
        assertEquals("✪", BedwarsStar.iconForCosmetic("star_white_circled"))
        assertEquals("⚝", BedwarsStar.iconForCosmetic("star_white_outlined"))
        assertEquals("✥", BedwarsStar.iconForCosmetic("star_four_clubs"))
        assertEquals("✭", BedwarsStar.iconForCosmetic("star_black_outlined"))
        assertEquals("✦", BedwarsStar.iconForCosmetic("star_four_pointed"))
        assertEquals("✯", BedwarsStar.iconForCosmetic("star_pinwheel"))
        assertEquals("✰", BedwarsStar.iconForCosmetic("star_hollow"))
        assertNull(BedwarsStar.iconForCosmetic("random_cosmetic"))
        assertNull(BedwarsStar.iconForCosmetic(null))

        // 368 and 592 are both Sapphire/Diamond-level tags whose players picked
        // the hollow star; the glyph must come from the cosmetic, not the level.
        assertEquals("§b[§b3§b6§b8§b✰§b]", BedwarsStar.formatStarTag(368, "✰"))
        assertEquals("§3[§35§39§32§3✰§3]", BedwarsStar.formatStarTag(592, "✰"))
    }

    @Test
    fun `the fetcher keeps the selected star cosmetic from flat and nested payloads`() {
        val flat = BedwarsFetcher.buildStats(
            payload(
                """
                {"displayname":"qskilz","bedwars_experience":1788000,
                 "bedwars_active_star":"star_hollow",
                 "bedwars_final_kills":11249,"bedwars_final_deaths":4446}
                """.trimIndent(),
            ),
            null,
        )
        check(flat is GameStats.Bedwars)
        assertEquals(368, flat.star)
        assertEquals("✰", flat.starIcon)

        val nested = BedwarsFetcher.buildStats(
            payload(
                """
                {"player":{"displayname":"qskilz","stats":{"Bedwars":{
                  "bedwars_experience":1788000,"active_star":"star_hollow",
                  "final_kills_bedwars":11249,"final_deaths_bedwars":4446
                }}}}
                """.trimIndent(),
            ),
            null,
        )
        check(nested is GameStats.Bedwars)
        assertEquals("✰", nested.starIcon)

        val missing = BedwarsFetcher.buildStats(
            payload(
                """
                {"displayname":"DefaultStar","bedwars_experience":1788000,
                 "bedwars_final_kills":11249,"bedwars_final_deaths":4446}
                """.trimIndent(),
            ),
            null,
        )
        check(missing is GameStats.Bedwars)
        assertNull(missing.starIcon)
    }

    @Test
    fun `single-colour prestiges colour every character`() {
        // 0-99 is the grey tier; the single-character colormap path must still emit
        // a code before the brackets as well as the text.
        assertEquals("§7[§74§72§7✫§7]", BedwarsStar.formatStarTag(42))
    }

    @Test
    fun `a payload with no game object is absence, not a rendered tag`() {
        // Fetching nothing must never fabricate a GameStats whose null fields the
        // formatter would turn into "?". The fetchers return null instead.
        val empty = JsonObject()
        assertNull(BedwarsFetcher.buildStats(empty, null))
        assertNull(DuelsFetcher.buildStats(empty, null))
        assertNull(SkyWarsFetcher.buildStats(empty, null))

        val bedwarsOnly = payload(
            """
            {"player":{"displayname":"RealPlayer","stats":{"Bedwars":{
              "bedwars_experience":5107000,
              "final_kills_bedwars":10,
              "final_deaths_bedwars":5
            }}}}
            """.trimIndent(),
        )
        assertNull(DuelsFetcher.buildStats(bedwarsOnly, null))
        assertNull(SkyWarsFetcher.buildStats(bedwarsOnly, null))
    }

    @Test
    fun `nicked is recognised from every shape the backend can send`() {
        assertTrue(StatsPayloadParser.isNicked(payload("""{"nicked":true}""")))
        assertTrue(StatsPayloadParser.isNicked(payload("""{"data":{"nicked":true}}""")))
        assertTrue(StatsPayloadParser.isNicked(payload("""{"player":{"displayname":"(nicked)"}}""")))
        assertTrue(StatsPayloadParser.isNicked(payload("""{"data":{"display":"(NICKED)"}}""")))

        assertFalse(StatsPayloadParser.isNicked(payload("""{"player":{"displayname":"RealPlayer"}}""")))
        assertFalse(StatsPayloadParser.isNicked(payload("""{"player":{"displayname":"NotNicked"}}""")))
    }

    @Test
    fun `a nicked upstream produces a nicked GameStats`() {
        val stats = BedwarsFetcher.buildStats(
            payload(
                """
                {"player":{"displayname":"(nicked)","stats":{"Bedwars":{
                  "bedwars_experience":5107000,
                  "final_kills_bedwars":10,
                  "final_deaths_bedwars":5
                }}}}
                """.trimIndent(),
            ),
            null,
        )
        check(stats is GameStats.Bedwars)
        assertTrue(stats.nicked)
    }

    private fun payload(json: String): JsonObject = JsonParser.parseString(json).asJsonObject
}
