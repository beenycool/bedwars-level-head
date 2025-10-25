package me.truffle.bedwarslevelhead.mixins

import me.truffle.bedwarslevelhead.features.NameTagRenderer
import net.minecraft.client.renderer.entity.RendererLivingEntity
import net.minecraft.entity.EntityLivingBase
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.ModifyVariable

@Mixin(RendererLivingEntity::class)
class EntityRendererMixin {

    @ModifyVariable(
        method = ["renderName"],
        at = At("HEAD"),
        argsOnly = true
    )
    fun modifyNameTag(name: String, entity: EntityLivingBase): String {
        if (NameTagRenderer.shouldRenderLevel() && entity is net.minecraft.entity.player.EntityPlayer) {
            return NameTagRenderer.modifyNameTag(name, entity.name)
        }
        return name
    }
}