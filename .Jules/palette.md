## 2024-05-23 - Interactive Chat Messages
**Learning:** In this Minecraft mod, `ChatComponentText` combined with `ClickEvent` and `HoverEvent` is the standard pattern for creating interactive CLI feedback (clickable links, command suggestions).
**Action:** Use `appendSibling` to chain these components for rich, actionable error messages or status updates.

## 2024-05-24 - Consistent Error Feedback

**Learning:** Asynchronous validation paths (like background API checks) often miss the rich feedback (clickable links) provided in synchronous checks, leading to a degraded UX for users who pass the initial format check but fail the server check.
**Action:** Always audit both synchronous and asynchronous validation paths to ensure error messages and helpful actions are consistent across all failure modes.

## 2024-05-25 - Hoverable Command Hints
**Learning:** For command arguments with finite options (like colors), listing them all in a static message clutters the chat. A hover event on the parameter name provides a cleaner way to show all valid choices without overwhelming the user.
**Action:** Use `HoverEvent.Action.SHOW_TEXT` on the argument name in error messages to display the full list of valid options, color-coded if applicable.

## 2024-05-26 - Consistent Command Suggestions
**Learning:** In Minecraft mods, consistent interactive feedback (e.g., clickable command suggestions) is crucial for complex configuration commands. If one error message offers a clickable fix, all similar messages should too.
**Action:** When updating command handlers, audit all error paths and usage help messages to ensure they leverage `createClickableCommand` or similar helpers for a uniform UX.
