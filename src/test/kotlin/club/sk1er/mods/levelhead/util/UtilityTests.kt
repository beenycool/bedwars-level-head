package club.sk1er.mods.levelhead.util

import me.beeny.bedwarslevelhead.utils.ChatUtils
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UtilityTests {
    
    @Test
    fun testColorCodeTranslation() {
        assertEquals("§7[§f100⭐§7]", ColorCodeTranslator.translate("&7[&f100⭐&7]"))
        assertEquals("§aGreen §cRed §rReset", ColorCodeTranslator.translate("&aGreen &cRed &rReset"))
        assertEquals("§l§nBold Underlined", ColorCodeTranslator.translate("&l&nBold Underlined"))
        assertEquals("No codes here", ColorCodeTranslator.translate("No codes here"))
        assertEquals("", ColorCodeTranslator.translate(""))
    }
    
    @Test
    fun testLevelExtraction() {
        // Standard formats
        assertEquals(100, ChatLevelDetector.extractLevel("[100⭐]"))
        assertEquals(250, ChatLevelDetector.extractLevel("250⭐"))
        assertEquals(500, ChatLevelDetector.extractLevel("⭐500"))
        
        // Without star
        assertEquals(100, ChatLevelDetector.extractLevel("[100]"))
        
        // In context
        assertEquals(150, ChatLevelDetector.extractLevel("Player [150⭐] joined the game"))
        assertEquals(123, ChatLevelDetector.extractLevel("Player [123✫] joined"))
        assertEquals(321, ChatLevelDetector.extractLevel("321✪"))
        
        // No level
        assertNull(ChatLevelDetector.extractLevel("No level here"))
    }
    
    @Test
    fun testPlayerNameExtraction() {
        assertNotNull(ChatLevelDetector.extractPlayerName("Notch joined the game"))
        assertNotNull(ChatLevelDetector.extractPlayerName("Player123 has"))
        assertNull(ChatLevelDetector.extractPlayerName("ab")) // Too short
        assertNull(ChatLevelDetector.extractPlayerName("ThisNameIsTooLongForMinecraft"))
    }
    
    @Test
    fun testLevelIndicatorDetection() {
        assertTrue(ChatLevelDetector.containsLevelIndicator("[100⭐]"))
        assertTrue(ChatLevelDetector.containsLevelIndicator("250⭐"))
        assertTrue(ChatLevelDetector.containsLevelIndicator("⭐500"))
        assertTrue(ChatLevelDetector.containsLevelIndicator("Player [150✫] joined"))
    }

    @Test
    fun testChatUtilsStarVariants() {
        assertEquals(123, ChatUtils.extractLevelFromMessage("[123✫] Player joined"))
        assertEquals(987, ChatUtils.extractLevelFromMessage("987✪"))
        assertEquals(543, ChatUtils.extractLevelFromMessage("✭543"))
    }
}
