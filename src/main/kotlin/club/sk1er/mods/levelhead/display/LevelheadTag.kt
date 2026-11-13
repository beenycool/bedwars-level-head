package club.sk1er.mods.levelhead.display

import java.awt.Color
import java.util.*

class LevelheadTag(val owner: UUID) {
    /** When the underlying stats were fetched; used to expire display tags. */
    var fetchedAt: Long = 0L

    var header: LevelheadComponent = LevelheadComponent()
    var footer: LevelheadComponent = LevelheadComponent()

    fun getString() = "${header.value}${footer.value}"

    override fun toString(): String = "LevelheadTag{header=$header, footer=$footer, owner=$owner}"

    class LevelheadComponent {
        /**
         * Raw string value for this component. Color codes are converted from '&' to '§'
         * when the value is set.
         */
        var value: String = ""
            set(v) {
                field = v.replace("&", "\u00a7")
            }

        var color: Color = Color.WHITE

        override fun toString(): String = "LevelheadComponent{value='$value', color='${color}'}"
    }
}
