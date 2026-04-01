# Palette Learnings

## 2024-05-24 - Interactive Chat Error Links & Action Cancellation

**Learning:** In Minecraft chat interfaces, long URLs (like GitHub issues) in error messages are extremely painful for users to copy/paste manually. Additionally, timeout-based confirmation prompts (`requireConfirmation`) trap the user in a pending state, preventing them from running other conflicting commands until the timeout expires.

**Action:** Always wrap plain-text URLs using `ClickEvent.Action.OPEN_URL` so users can click them directly. For confirmation flows, always provide an explicit, clickable `[Cancel]` button alongside `[Confirm]` that immediately clears the pending state.

## 2024-05-24 - Profile Import Confirmation

**Learning:** Importing a profile via clipboard overwrites the user's current configuration. A `[Click to import]` control after export must not apply data on a single accidental activation, including when the user runs `/levelhead profile import` manually.

**Action:** Validate clipboard JSON, then wrap the apply step in `requireConfirmation` (same pattern as other destructive commands). With confirmation in the command, chat may use `ClickEvent.Action.RUN_COMMAND` to start the flow; `SUGGEST_COMMAND` alone does not protect users who type or bind the command directly.
