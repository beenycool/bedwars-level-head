package club.sk1er.mods.levelhead.gui

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.MasterConfig
import net.minecraft.client.gui.GuiButton
import net.minecraft.client.gui.GuiScreen
import net.minecraft.client.resources.I18n
import org.lwjgl.input.Keyboard
import org.polyfrost.oneconfig.api.gui.OneConfigGUI

/**
 * LevelheadToggleScreen has been replaced with OneConfig's auto-generated configuration GUI.
 * 
 * This file is kept for legacy compatibility and can be removed in a future version.
 * Users can now access the mod configuration through OneConfig's GUI system.
 */
class LevelheadToggleScreen : GuiScreen() {

    private lateinit var configButton: GuiButton
    private lateinit var toggleButton: GuiButton

    override fun initGui() {
        Keyboard.enableRepeatEvents(true)
        buttonList.clear()
        
        // OneConfig GUI button
        configButton = GuiButton(0, width / 2 - 100, height / 2 - 50, 200, 20, "Open Config GUI")
        
        // Simple toggle button
        toggleButton = GuiButton(1, width / 2 - 100, height / 2 - 20, 200, 20, toggleLabel())
        
        // Close button
        buttonList.add(GuiButton(2, width / 2 - 100, height / 2 + 20, 200, 20, I18n.format("gui.done")))
        
        buttonList.add(configButton)
        buttonList.add(toggleButton)
    }

    override fun onGuiClosed() {
        super.onGuiClosed()
        Keyboard.enableRepeatEvents(false)
    }

    override fun actionPerformed(button: GuiButton) {
        when (button.id) {
            0 -> {
                // Open OneConfig GUI
                OneConfigGUI.openGUI("levelhead")
            }
            1 -> {
                // Simple toggle using OneConfig
                MasterConfig.enabled = !MasterConfig.enabled
                toggleButton.displayString = toggleLabel()
            }
            2 -> {
                mc.displayGuiScreen(null)
            }
        }
    }

    override fun drawScreen(mouseX: Int, mouseY: Int, partialTicks: Float) {
        drawDefaultBackground()
        val title = "BedWars Levelhead - Configuration"
        drawCenteredString(fontRendererObj, title, width / 2, height / 2 - 90, 0xFFFFFF)
        
        val (statusText, statusColor) = if (MasterConfig.enabled) {
            "Enabled" to ENABLED_COLOR
        } else {
            "Disabled" to DISABLED_COLOR
        }
        
        drawCenteredString(fontRendererObj, "Status: $statusText", width / 2, height / 2 - 70, statusColor)
        drawCenteredString(
            fontRendererObj,
            "Use the buttons below to configure the mod.",
            width / 2,
            height / 2 - 50,
            0xCCCCCC
        )
        drawCenteredString(
            fontRendererObj,
            "The Config GUI button opens the full OneConfig interface.",
            width / 2,
            height / 2 - 30,
            0xAAAAAA
        )
        super.drawScreen(mouseX, mouseY, partialTicks)
    }

    private fun toggleLabel(): String {
        return if (MasterConfig.enabled) {
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
