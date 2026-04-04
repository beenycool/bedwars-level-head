# 2024-05-24 - Interactive Chat Error Links & Action Cancellation

**Learning:** In Minecraft chat interfaces, long URLs (like GitHub issues) in error messages are extremely painful for users to copy/paste manually. Additionally, timeout-based confirmation prompts (`requireConfirmation`) trap the user in a pending state, preventing them from running other conflicting commands until the timeout expires.
**Action:** Always wrap plain-text URLs using `ClickEvent.Action.OPEN_URL` so users can click them directly. For confirmation flows, always provide an explicit, clickable `[Cancel]` button alongside `[Confirm]` that immediately clears the pending state.

## 2024-05-24 - Safe Clipboard Actions

**Learning:** When generating interactive chat components that involve clipboard actions (like importing configurations), using `RUN_COMMAND` can accidentally trigger destructive actions if the clipboard contains unexpected data—for example, a clickable `[Click to import]` after export can overwrite config on one mis-click. Users need a chance to verify before execution.
**Action:** For potentially destructive actions (like importing configurations), prefer using the `requireConfirmation` utility within the command logic. For interactive chat components that trigger these actions, use `SUGGEST_COMMAND` instead of `RUN_COMMAND` to suggest the import command in the chat bar so the user can review before sending it.
