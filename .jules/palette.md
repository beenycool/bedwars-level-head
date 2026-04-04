# Palette Learnings

## 2024-05-24 - Interactive Chat Error Links & Action Cancellation

**Learning:** In Minecraft chat interfaces, long URLs (like GitHub issues) in error messages are extremely painful for users to copy/paste manually. Additionally, timeout-based confirmation prompts (`requireConfirmation`) trap the user in a pending state, preventing them from running other conflicting commands until the timeout expires.

**Action:** Always wrap plain-text URLs using `ClickEvent.Action.OPEN_URL` so users can click them directly. For confirmation flows, always provide an explicit, clickable `[Cancel]` button alongside `[Confirm]` that immediately clears the pending state.

## 2024-05-24 - Profile Import Confirmation

**Learning:** Importing a profile via clipboard overwrites the user's current configuration. A `[Click to import]` control after export must not apply data on a single accidental activation, including when the user runs `/levelhead profile import` manually.

**Action:** Validate clipboard JSON, then wrap the apply step in `requireConfirmation` (same pattern as other destructive commands). Prefer `SUGGEST_COMMAND` for `[Click to import]` and for preset names in `/levelhead profile list` so the command is visible before Enter; confirmation still runs when the command executes, so direct runs and keybinds stay safe. Wrap preset apply in `requireConfirmation` before replacing configuration.
