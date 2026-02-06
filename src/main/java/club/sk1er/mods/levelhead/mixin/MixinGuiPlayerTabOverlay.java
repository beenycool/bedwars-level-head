package club.sk1er.mods.levelhead.mixin;

import club.sk1er.mods.levelhead.Levelhead;
import club.sk1er.mods.levelhead.config.LevelheadConfig;
import club.sk1er.mods.levelhead.core.GameMode;
import club.sk1er.mods.levelhead.core.GameStats;
import net.minecraft.client.gui.GuiPlayerTabOverlay;
import net.minecraft.client.network.NetworkPlayerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Collections;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Mixin to append BedWars FKDR stats to player names in the Tab list.
 */
@Mixin(GuiPlayerTabOverlay.class)
public class MixinGuiPlayerTabOverlay {
    private static final long TAB_FETCH_RETRY_MS = 4000L;
    private static final long TAB_FETCH_ENTRY_TTL_MS = 5 * 60 * 1000L;
    private static final long TAB_FETCH_CLEANUP_INTERVAL_MS = 60 * 1000L;
    private static final ConcurrentHashMap<UUID, Long> TAB_FETCH_ATTEMPTS = new ConcurrentHashMap<>();
    private static final AtomicLong TAB_FETCH_LAST_CLEANUP = new AtomicLong();

    @Inject(method = "getPlayerName", at = @At("RETURN"), cancellable = true)
    private void levelhead$appendFkdrToTabName(NetworkPlayerInfo networkPlayerInfo, CallbackInfoReturnable<String> cir) {
        // Check if the feature is enabled
        if (!LevelheadConfig.INSTANCE.getShowTabStats()) {
            return;
        }

        // Check if on Hypixel
        if (!Levelhead.INSTANCE.isOnHypixel()) {
            return;
        }

        // Get the player's UUID
        UUID uuid = networkPlayerInfo.getGameProfile().getId();
        if (uuid == null) {
            return;
        }

        // Fetch cached stats
        GameStats stats = Levelhead.INSTANCE.getCachedStats(uuid, GameMode.BEDWARS);
        if (!(stats instanceof GameStats.Bedwars)) {
            requestTabStatsIfNeeded(uuid);
            return;
        }

        GameStats.Bedwars bedwarsStats = (GameStats.Bedwars) stats;

        // Get FKDR value
        Double fkdr = bedwarsStats.getFkdr();
        Integer star = bedwarsStats.getStar();

        // Determine color based on FKDR thresholds
        String fkdrColorCode;
        if (fkdr != null) {
            if (fkdr >= 10.0) {
                fkdrColorCode = "§6"; // Gold
            } else if (fkdr >= 6.0) {
                fkdrColorCode = "§e"; // Yellow
            } else if (fkdr >= 3.0) {
                fkdrColorCode = "§a"; // Green
            } else if (fkdr >= 1.0) {
                fkdrColorCode = "§f"; // White
            } else {
                fkdrColorCode = "§7"; // Gray
            }
        } else {
            fkdrColorCode = "§7";
        }

        // Format the FKDR
        String fkdrText = (fkdr != null) ? String.format(Locale.ROOT, "%.2f", fkdr) : "?";

        // Format the Star
        String starText = "";
        if (star != null) {
            String starColor = getStarColor(star);
            starText = starColor + "[" + star + "✪]§r ";
        }

        // Append to the original name
        String originalName = cir.getReturnValue();
        String modifiedName = starText + originalName + " §7: " + fkdrColorCode + fkdrText;

        cir.setReturnValue(modifiedName);
    }

    private void requestTabStatsIfNeeded(UUID uuid) {
        long now = System.currentTimeMillis();
        cleanupTabFetchAttempts(now);
        Long last = TAB_FETCH_ATTEMPTS.get(uuid);
        if (last != null && now - last < TAB_FETCH_RETRY_MS) {
            return;
        }
        TAB_FETCH_ATTEMPTS.put(uuid, now);

        if (Levelhead.INSTANCE.getDisplayManager().primaryDisplay() == null) {
            return;
        }

        String trimmedUuid = uuid.toString().replace("-", "");
        Levelhead.LevelheadRequest request = new Levelhead.LevelheadRequest(
            trimmedUuid,
            Levelhead.INSTANCE.getDisplayManager().primaryDisplay(),
            false,
            GameMode.BEDWARS.getTypeId()
        );
        Levelhead.INSTANCE.fetchBatch(Collections.singletonList(request));
    }

    private void cleanupTabFetchAttempts(long now) {
        long lastCleanup = TAB_FETCH_LAST_CLEANUP.get();
        if (now - lastCleanup < TAB_FETCH_CLEANUP_INTERVAL_MS) {
            return;
        }
        if (!TAB_FETCH_LAST_CLEANUP.compareAndSet(lastCleanup, now)) {
            return;
        }
        TAB_FETCH_ATTEMPTS.entrySet().removeIf(entry -> now - entry.getValue() > TAB_FETCH_ENTRY_TTL_MS);
    }

    private String getStarColor(int star) {
        if (star < 100) return "§7";        // Stone
        if (star < 200) return "§f";        // Iron
        if (star < 300) return "§6";        // Gold
        if (star < 400) return "§b";        // Diamond
        if (star < 500) return "§2";        // Emerald
        if (star < 600) return "§3";        // Sapphire
        if (star < 700) return "§4";        // Ruby
        if (star < 800) return "§d";        // Crystal
        if (star < 900) return "§9";        // Opal
        if (star < 1000) return "§5";       // Amethyst
        // 1000+ variants
        if (star < 1100) return "§c";       // Rainbow/Red
        if (star < 1200) return "§f";       // Iron Prime (White)
        if (star < 1300) return "§e";       // Gold Prime (Yellow)
        if (star < 1400) return "§b";       // Diamond Prime
        if (star < 1500) return "§a";       // Emerald Prime
        if (star < 1600) return "§3";       // Sapphire Prime
        if (star < 1700) return "§4";       // Ruby Prime
        if (star < 1800) return "§d";       // Crystal Prime
        if (star < 1900) return "§9";       // Opal Prime
        if (star < 2000) return "§5";       // Amethyst Prime
        
        return "§6"; // Default/Fallover
    }
}
