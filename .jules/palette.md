# Palette's Journal

## 2026-02-18 - Interactive Chat Help

**Learning:** Users benefit significantly from clickable chat commands, and implementing them is a low-effort, high-impact UX win. Existing infrastructure (`IChatComponent`) makes this easy.
**Action:** Always check for `IChatComponent` support in chat command handlers to provide clickable suggestions or run commands directly.

## 2026-02-19 - Clickable Status Indicators

**Learning:** For boolean states displayed in chat (like "Enabled"/"Disabled"), use direct RUN_COMMAND actions instead of SUGGEST_COMMAND to provide immediate control.
**Action:** When displaying configuration state in chat, wrap the status text in a ClickEvent that toggles the setting.

## 2026-03-12 - Interactive Catch Blocks

**Learning:** Exception handling and error blocks (like network failures or unselected targets) often produce static text that strands the user. By converting 'Unexpected error' or 'Not looking at a player' messages into interactive suggestions (e.g., checking status, using a manual command), we provide an immediate path forward.
**Action:** When writing catch blocks or failure states in command handlers, don't just log and send static text. Always use `CommandUtils.buildInteractiveFeedback` to suggest the next logical step (like `/levelhead status` or `/levelhead whois`).
## 2025-03-20 - Interactive Status Commands
**Learning:** Purely informational commands (like `/levelhead status`) present excellent micro-UX opportunities when key data points are naturally linked to configuration commands, but they are often neglected because they "just show text".
**Action:** When creating status readout commands, identify configuration metrics (e.g. cache TTL, proxy state, cache size) and format them as interactive components (with `ChatComponentText` and `ClickEvent`) that suggest the related modification command (e.g. `/levelhead cachettl <value>`).
## 2024-05-24 - Add explicit lookup action to copied identifier feedback
**Learning:** Users might not realize that copying an identifier to their clipboard implies they can click the raw UUID to immediately process it.
**Action:** Always append explicit action links like `[Click to lookup]` when outputting a copied identifier to chat.
