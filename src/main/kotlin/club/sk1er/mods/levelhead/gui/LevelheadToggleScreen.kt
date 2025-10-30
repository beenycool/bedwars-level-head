package club.sk1er.mods.levelhead.gui

import club.sk1er.mods.levelhead.Levelhead
import net.minecraft.client.gui.GuiButton
import net.minecraft.client.gui.GuiScreen
import net.minecraft.client.resources.I18n
import org.lwjgl.input.Keyboard

class LevelheadToggleScreen : GuiScreen() {

    private lateinit var toggleButton: GuiButton

    override fun initGui() {
        Keyboard.enableRepeatEvents(true)
        buttonList.clear()
        toggleButton = GuiButton(0, width / 2 - 100, height / 2 - 2, 200, 20, toggleLabel())
        buttonList.add(toggleButton)
        buttonList.add(GuiButton(1, width / 2 - 100, height / 2 + 24, 200, 20, I18n.format("gui.done")))
    }

    override fun onGuiClosed() {
        super.onGuiClosed()
        Keyboard.enableRepeatEvents(false)
    }

    override fun actionPerformed(button: GuiButton) {
        when (button.id) {
            0 -> {
                val newEnabled = !Levelhead.displayManager.config.enabled
                Levelhead.displayManager.setEnabled(newEnabled)
                toggleButton.displayString = toggleLabel()
            }
            1 -> mc.displayGuiScreen(null)
        }
    }

    override fun drawScreen(mouseX: Int, mouseY: Int, partialTicks: Float) {
        drawDefaultBackground()
        val title = "BedWars Levelhead"
        drawCenteredString(fontRendererObj, title, width / 2, height / 2 - 60, 0xFFFFFF)
        val (statusText, statusColor) = if (Levelhead.displayManager.config.enabled) {
            "Enabled" to ENABLED_COLOR
        } else {
            "Disabled" to DISABLED_COLOR
        }
        drawCenteredString(fontRendererObj, "Status: $statusText", width / 2, height / 2 - 40, statusColor)
        drawCenteredString(
            fontRendererObj,
            "Click the button below to toggle the display.",
            width / 2,
            height / 2 - 24,
            0xCCCCCC
        )
        super.drawScreen(mouseX, mouseY, partialTicks)
    }

    private fun toggleLabel(): String {
        return if (Levelhead.displayManager.config.enabled) {
            "Disable BedWars Levelhead"
        } else {
            "Enable BedWars Levelhead"
        }
    }

    private companion object {
        private const val ENABLED_COLOR = 0x55FF55
        private const val DISABLED_COLOR = 0xFF5555
    }
}
