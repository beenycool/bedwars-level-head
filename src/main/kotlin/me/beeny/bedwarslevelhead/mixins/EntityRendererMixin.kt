package me.beeny.bedwarslevelhead.mixins

import me.beeny.bedwarslevelhead.features.NameTagRenderer
import net.minecraft.client.renderer.entity.RendererLivingEntity
import net.minecraft.entity.EntityLivingBase
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.ModifyVariable

@Mixin(RendererLivingEntity::class)
class EntityRendererMixin {

    @ModifyVariable(
        method = ["renderName", "func_177067_a"],
        at = At("STORE"),
        ordinal = 0
    )
    fun modifyNameTag(name: String, entity: EntityLivingBase): String {
        if (NameTagRenderer.shouldRenderLevel() && entity is net.minecraft.entity.player.EntityPlayer) {
            return NameTagRenderer.modifyNameTag(name, entity.name)
        }
        return name
    }
}