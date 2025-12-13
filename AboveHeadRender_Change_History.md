# AboveHeadRender.kt Change History

This file contains a complete history of all changes made to `src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt`.

## Complete Change Log

| Date | Commit Hash | Author | Description |
|------|-------------|---------|-------------|
| 2025-12-07 19:47:06 | `ed59072` | beeny | feat: Implement player data submission, validation, and signature verification with new utility modules and clients |
| 2025-12-07 18:22:14 | `2927337` | beenycool | Merge branch 'master' into feature/pr-prep-2025-12-07 |
| 2025-12-07 18:14:40 | `b537f68` | beeny | fds |
| 2025-12-07 12:16:45 | `f6b1362` | beenycool | Address review feedback |
| 2025-12-07 11:51:34 | `9f6b230` | beeny | Prepare PR: include recent changes across backend and client |
| 2025-12-06 16:19:14 | `c048f0b` | beeny | feat: Implement request batching for level head data and optimize rendering with frustum culling and batched GL state, while also migrating backend memoization to LRU cache. |
| 2025-12-04 17:29:45 | `36a458a` | beenycool | Address reviewer feedback |
| 2025-12-04 16:54:53 | `9e475e8` | beeny | Update stats rendering and configuration improvements |
| 2025-12-02 16:52:36 | `44c1165` | beeny | fix lag |
| 2025-12-02 16:50:03 | `c0e44d1` | beeny | Update stats rendering and configuration improvements |
| 2025-11-30 16:19:31 | `2d0ff45` | beeny | add new stats to /stats |
| 2025-11-30 16:16:17 | `cbbe398` | beeny | Update AboveHeadRender |
| 2025-11-30 16:16:09 | `437692c` | beeny | Update DisplayManager and AboveHeadRender |
| 2025-11-30 16:15:37 | `372f339` | beeny | fdsa |
| 2025-11-30 16:03:18 | `acb5678` | beenycool | Make config endpoints dynamic and refine chart limit logic |
| 2025-11-30 15:37:57 | `eb71166` | beeny | toot |
| 2025-11-30 10:24:57 | `0b1b3ba` | beenycool | Use NameFormat event for above-head tags |
| 2025-11-29 17:46:37 | `cdb2192` | beenycool | Remove chroma options and add settings reset |
| 2025-11-19 10:50:03 | `5876a31` | beenycool | Finish Polyfrost config migration and batch hardening |
| 2025-10-16 08:04:58 | `7bfc459` | beenycool | Fix config parsing and clarify tag centering |
| 2025-10-14 18:45:04 | `ef4c402` | beenycool | Strip mod to BedWars star display only |
| 2025-10-14 16:33:46 | `2e7ee9e` | beenycool | Fix BedWars toggle build regressions |
| 2025-10-13 19:42:23 | `913e173` | beenycool | Implement BedWars star detection and rendering guards |
| 2021-12-26 08:07:59 | `79cc4b1` | Sychic | AboveHeadRender: Add pixel of background |
| 2021-12-22 16:55:50 | `ad9409a` | Sychic | New: 1.12.2 support |
| 2021-12-22 07:22:26 | `8b24c9f` | Sychic | AboveHeadRender: Use UC |
| 2021-12-20 15:03:43 | `a0e9c4a` | Sychic | LevelheadPreview: Update properly |
| 2021-12-10 23:56:06 | `e8c4a77` | Sychic | LevelheadGUI: Cleanup |
| 2021-11-26 16:11:35 | `cbda972` | Sychic | Levelhead: General cleanup |
| 2021-11-26 13:38:39 | `bacb43a` | Sychic | ChatRender: Implement in Kotlin |
| 2021-11-26 00:24:34 | `5dc3c77` | Sychic | TabRenderer: Implement in Kotlin |
| 2021-11-21 15:30:00 | `962df1f` | Sychic | Levelhead: Reimplement functionality with kotlin |

## Summary Statistics

- **Total Changes**: 32 commits
- **First Change**: November 21, 2021 (Kotlin migration)
- **Latest Change**: December 7, 2025 (Player data submission implementation)
- **Development Period**: ~4 years
- **Primary Authors**: Sychic (early development), beeny & beenycool (recent development)

## Major Development Phases

### Initial Development (2021)
- Kotlin migration and initial implementation
- Basic above-head rendering functionality
- Minecraft version support updates (1.12.2)

### Configuration & Enhancement (2025)
- Polyfrost config migration
- BedWars star detection and display
- Performance optimizations and rendering improvements
- Advanced features like request batching and frustum culling

### Recent Features (Late 2025)
- Player data submission and validation
- Signature verification
- Backend integration improvements
- Enhanced stats rendering

---
*Generated on: December 9, 2025*
*File: src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt*