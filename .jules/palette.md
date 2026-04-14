# Palette Learnings

## 2024-05-24 - Interactive Chat Error Links & Action Cancellation

**Learning:** In Minecraft chat interfaces, long URLs (like GitHub issues) in error messages are extremely painful for users to copy/paste manually. Additionally, timeout-based confirmation prompts (`requireConfirmation`) trap the user in a pending state, preventing them from running other conflicting commands until the timeout expires.

**Action:** Always wrap plain-text URLs using `ClickEvent.Action.OPEN_URL` so users can click them directly. For confirmation flows, always provide an explicit, clickable `[Cancel]` button alongside `[Confirm]` that immediately clears the pending state.

## 2024-05-24 - Profile Import Confirmation

**Learning:** Importing a profile via clipboard overwrites the user's current configuration. A `[Click to import]` control after export must not apply data on a single accidental activation, including when the user runs `/levelhead profile import` manually.

**Action:** Validate clipboard JSON, then wrap the apply step in `requireConfirmation` (same pattern as other destructive commands). Prefer `SUGGEST_COMMAND` for `[Click to import]` and for preset names in `/levelhead profile list` so the command is visible before Enter; confirmation still runs when the command executes, so direct runs and keybinds stay safe. Wrap preset apply in `requireConfirmation` before replacing configuration.

## 2024-05-24 - Make Example Safe Admin Commands Executable

**Learning:** When displaying example admin commands (like cache purging) in a help menu, setting `run = false` causes the command to be placed in the user's chat input area instead of running immediately. For safe, repeatable, non-destructive examples, this creates an unnecessary extra step.

**Action:** Use `run = true` in `CommandUtils.buildInteractiveFeedback` for safe, fully-formed example commands like `/levelhead admin purgecache`. Examples containing placeholders (e.g., player names) should continue to use `run = false` to allow user editing before execution.

## 2024-05-24 - Micro-UX Clarity in Command Tooltips

**Learning:** Vague tooltip messages in `HoverEvent`s, such as "Click to fill command" or "Click to run command", can confuse users about what exactly is being filled or run, especially when commands involve external data like UUIDs or complex configuration values.

**Action:** Ensure `HoverEvent` tooltips are explicit about the outcome. For standard commands, prefer "Click to fill command" or "Click to run command". For specific data, use "Click to fill UUID", etc. When using `CommandUtils.createClickableCommand`, utilize the `hoverTextOverride` parameter to provide this explicitly descriptive tooltip text.
## 2024-05-24 - Explicit Tooltips for Clickable Text
**Learning:** Vague tooltips like "Click to fill command" or "Click to run command" do not provide enough context for users navigating interactive chat configurations.
**Action:** Always provide explicitly descriptive tooltips detailing exactly what happens (e.g., "Click to fill apply command", "Click to view display settings") using the `hoverTextOverride` parameter when creating `CommandUtils.createClickableCommand` elements.
