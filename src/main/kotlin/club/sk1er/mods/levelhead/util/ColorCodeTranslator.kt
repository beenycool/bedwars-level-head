package club.sk1er.mods.levelhead.util

/**
 * Utility for translating ampersand color codes to section symbols.
 * Useful for user-facing configuration where & is easier to type than §.
 */
object ColorCodeTranslator {
    
    /**
     * Translates ampersand (&) color codes to Minecraft section symbol (§) codes.
     * Supports all standard Minecraft color and formatting codes.
     * 
     * @param text The text with ampersand codes (e.g., "&7[&f100⭐&7]")
     * @return The text with section symbol codes (e.g., "§7[§f100⭐§7]")
     */
    fun translate(text: String): String {
        if (text.isEmpty()) return text
        
        val builder = StringBuilder(text.length)
        var i = 0
        
        while (i < text.length) {
            if (text[i] == '&' && i + 1 < text.length) {
                val code = text[i + 1].lowercaseChar()
                // Check if it's a valid Minecraft color/format code
                if (isValidCode(code)) {
                    builder.append('§').append(code)
                    i += 2
                    continue
                }
            }
            builder.append(text[i])
            i++
        }
        
        return builder.toString()
    }
    
    /**
     * Checks if a character is a valid Minecraft color or formatting code.
     * Valid codes: 0-9, a-f (colors), k-o, r (formatting)
     */
    private fun isValidCode(code: Char): Boolean {
        return code in '0'..'9' || code in 'a'..'f' || code in 'k'..'o' || code == 'r'
    }
}
