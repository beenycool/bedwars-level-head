# 2024-05-24 - Interactive Chat Error Links & Action Cancellation

**Learning:** In Minecraft chat interfaces, long URLs (like GitHub issues) in error messages are extremely painful for users to copy/paste manually. Additionally, timeout-based confirmation prompts (`requireConfirmation`) trap the user in a pending state, preventing them from running other conflicting commands until the timeout expires.
**Action:** Always wrap plain-text URLs using `ClickEvent.Action.OPEN_URL` so users can click them directly. For confirmation flows, always provide an explicit, clickable `[Cancel]` button alongside `[Confirm]` that immediately clears the pending state.

## 2024-05-24 - Safe Clipboard Actions
**Learning:** When generating interactive chat components that involve clipboard actions (like importing configurations), using `RUN_COMMAND` can accidentally trigger destructive actions if the clipboard contains unexpected data. Users need a chance to verify before execution.
**Action:** Use `SUGGEST_COMMAND` for potentially destructive clipboard imports (like `[Click to import]`) to pre-fill the command in chat, allowing the user to review or back out safely.
