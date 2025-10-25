package me.truffle.bedwarslevelhead.utils

object ColorUtils {
    private val colorCodes = mapOf(
        '0' to "000000", '1' to "0000AA", '2' to "00AA00", '3' to "00AAAA",
        '4' to "AA0000", '5' to "AA00AA", '6' to "FFAA00", '7' to "AAAAAA",
        '8' to "555555", '9' to "5555FF", 'a' to "55FF55", 'b' to "55FFFF",
        'c' to "FF5555", 'd' to "FF55FF", 'e' to "FFFF55", 'f' to "FFFFFF",
        'k' to "obfuscated", 'l' to "bold", 'm' to "strikethrough", 'n' to "underline", 'o' to "italic", 'r' to "reset"
    )

    fun translateColorCodes(text: String): String {
        val builder = StringBuilder()
        var i = 0
        while (i < text.length) {
            if (text[i] == '&' && i + 1 < text.length) {
                val colorCode = text[i + 1]
                if (colorCodes.containsKey(colorCode)) {
                    builder.append("§").append(colorCode)
                    i += 2
                    continue
                }
            }
            builder.append(text[i])
            i++
        }
        return builder.toString()
    }
}