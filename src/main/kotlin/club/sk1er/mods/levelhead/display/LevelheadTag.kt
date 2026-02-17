package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import com.google.gson.JsonObject
import java.awt.Color
import java.util.*

class LevelheadTag(val owner: UUID) {
    var lastSeen: Long = System.currentTimeMillis()
    var header: LevelheadComponent = LevelheadComponent()
    var footer: LevelheadComponent = LevelheadComponent()

    fun getString() = "${header.value}${footer.value}"

    override fun toString(): String = "LevelheadTag{header=$header, footer=$footer, owner=$owner}"

    fun clone(): LevelheadTag = LevelheadTag(owner).also {
        it.header = header.clone()
        it.footer = footer.clone()
    }

    companion object {
        fun build(owner: UUID, block: LevelheadTagBuilder.() -> Unit) =
            LevelheadTagBuilder(owner).apply(block).tag
    }

    class LevelheadTagBuilder(owner: UUID) {
        val tag = LevelheadTag(owner)

        fun header(block: LevelheadComponent.() -> Unit) =
            tag.header.apply(block)

        fun footer(block: LevelheadComponent.() -> Unit) =
            tag.footer.apply(block)
    }

    class LevelheadComponent {
        /**
         * Raw string value for this component. Color codes are converted from '&' to '§'
         * when the value is set. Whenever the value changes, the cached width is invalidated.
         */
        var value: String = ""
            set(v) {
                field = v.replace("&", "\u00a7")
                cachedWidth = -1
            }

        var color: Color = Color.WHITE
        var chroma: Boolean = false

        /**
         * Cached pixel width for this component's value. This is computed lazily via
         * [getWidth] the first time it is needed after the value changes. Using -1 as
         * a sentinel avoids needing an additional boolean flag.
         */
        private var cachedWidth: Int = -1

        /**
         * Returns the width of [value] using the provided [fontRenderer], computing and
         * caching it on first access after a change. This avoids repeatedly calling
         * FontRenderer#getStringWidth on static or rarely changing text every frame.
         */
        fun getWidth(fontRenderer: net.minecraft.client.gui.FontRenderer): Int {
            if (cachedWidth == -1) {
                cachedWidth = fontRenderer.getStringWidth(value)
            }
            return cachedWidth
        }

        override fun toString(): String = "LevelheadComponent{value='$value', color='${color}', chroma=$chroma}"

        fun clone(): LevelheadComponent = LevelheadComponent().also {
            it.value = value
            it.color = color
            it.chroma = chroma
        }
    }
}
