## 2024-05-23 - Interactive Chat Messages
**Learning:** In this Minecraft mod, `ChatComponentText` combined with `ClickEvent` and `HoverEvent` is the standard pattern for creating interactive CLI feedback (clickable links, command suggestions).
**Action:** Use `appendSibling` to chain these components for rich, actionable error messages or status updates.

## 2024-05-24 - Consistent Error Feedback
**Learning:** Asynchronous validation paths (like background API checks) often miss the rich feedback (clickable links) provided in synchronous checks, leading to a degraded UX for users who pass the initial format check but fail the server check.
**Action:** Always audit both synchronous and asynchronous validation paths to ensure error messages and helpful actions are consistent across all failure modes.
