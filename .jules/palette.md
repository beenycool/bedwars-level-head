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
