package club.sk1er.mods.levelhead.core

/**
 * PolyNametag hooks the vanilla drawString overload in AboveHeadRender and applies
 * its Text Type itself. Patcher has no such hook, so its nametag shadow is read
 * reflectively as a fallback when PolyNametag is absent.
 */
object NametagShadowCompat {
    private val polyClass = runCatching {
        Class.forName("org.polyfrost.polynametag.config.ModConfig")
    }.getOrNull()
    private val polyInstanceField = runCatching { polyClass?.getField("INSTANCE") }.getOrNull()
    private val polyEnabledField = runCatching { polyClass?.getField("enabled") }.getOrNull()

    val polyNametagActive: Boolean
        get() {
            val instance = runCatching { polyInstanceField?.get(null) }.getOrNull() ?: return false
            return runCatching { polyEnabledField?.getBoolean(instance) }.getOrNull() ?: true
        }

    private val patcherClass = runCatching {
        Class.forName("club.sk1er.patcher.config.PatcherConfig")
    }.getOrNull()
    private val patcherNametagField = runCatching { patcherClass?.getField("shadowedNametagText") }.getOrNull()
    private val patcherDisableField = runCatching { patcherClass?.getField("disableShadowedText") }.getOrNull()

    fun patcherTextShadow(): Boolean? {
        val field = patcherNametagField ?: return null
        val shadow = runCatching { field.getBoolean(null) }.getOrNull() ?: return null
        val disabled = runCatching { patcherDisableField?.getBoolean(null) }.getOrNull() ?: false
        return shadow && !disabled
    }
}
