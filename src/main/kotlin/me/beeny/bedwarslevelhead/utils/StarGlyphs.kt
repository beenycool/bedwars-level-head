package me.beeny.bedwarslevelhead.utils

import java.util.regex.Pattern

/**
 * Central list of star-like glyphs Hypixel uses for BedWars prestige levels.
 * This includes the common ✫/✪ variants plus a selection of related Unicode stars
 * to cover prestige icons across seasons.
 */
object StarGlyphs {
    private val glyphs = listOf(
        '⭐', '✫', '✪', '✭', '✮', '✯', '★', '☆', '✰', '✱', '✲', '✳', '✴', '✵', '✶',
        '✷', '✸', '✹', '✺', '✻', '✼', '✽', '✾', '✿', '❂', '❋', '⍟'
    )

    /** Alternation pattern like `(?:\Q✫\E|\Q✪\E|...)` for use in regexes. */
    val alternation: String = glyphs.joinToString(separator = "|") { Pattern.quote(it.toString()) }
}
