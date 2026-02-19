# Palette's Journal

## 2026-02-18 - Interactive Chat Help

**Learning:** Users benefit significantly from clickable chat commands, and implementing them is a low-effort, high-impact UX win. Existing infrastructure (`IChatComponent`) makes this easy.
**Action:** Always check for `IChatComponent` support in chat command handlers to provide clickable suggestions or run commands directly.

## 2026-05-25 - Clickable Status Indicators

**Learning:** For boolean states displayed in chat (like "Enabled"/"Disabled"), use direct RUN_COMMAND actions instead of SUGGEST_COMMAND to provide immediate control.
**Action:** When displaying configuration state in chat, wrap the status text in a ClickEvent that toggles the setting.
