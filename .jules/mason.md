# 2026-03-18 - Replacing unknown object casts

**Tech Debt:** Inline `any` assertions used directly to access untyped JSON payload keys, then initially replaced with `Record<string, unknown>`.
**Learning:** Casting a dynamic object to `Record<string, unknown>` before extracting primitives makes those extracted primitives inherently `unknown`. Assigning `unknown` to properties restricted to specific types (e.g., `number | undefined`) causes TS compilation errors. Trying to resolve this inline leads to an unreadable mess of repeated assertions (e.g., `((obj as ...).prop as ...)`).
**Prevention:** Cast dynamic objects directly to structurally accurate types matching the primitives you need to extract (e.g., `const bedwars = obj as Record<string, number | undefined>`) so properties naturally resolve to the required types, maintaining both type-safety and readability without inline verbosity.
## 2024-05-19 - Removed unsafe 'any' typings in generic JSON extraction
**Tech Debt:** `extractBedwarsRecord` in validation utilities used `any` types and `as any` casting for deeply nested JSON access, creating an unchecked gap in type safety.
**Learning:** Working with loosely typed inputs from Express routes makes it easy to fall back to `any`. This bypasses strict TypeScript checks, leading to potential unseen runtime assignment bugs.
**Prevention:** Avoid `any`. Treat arbitrary inputs as `unknown`, then explicitly use type guards (like `isNonArrayObject()`) to assert them into structural objects (e.g., `Record<string, unknown>`), traversing properties cleanly.
