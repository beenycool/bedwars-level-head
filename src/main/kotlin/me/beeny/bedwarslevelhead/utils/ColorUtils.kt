package me.beeny.bedwarslevelhead.utils

import club.sk1er.mods.levelhead.util.ColorCodeTranslator

object ColorUtils {
    fun translateColorCodes(text: String): String = ColorCodeTranslator.translate(text)
}