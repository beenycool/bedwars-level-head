## 2024-05-23 - Focus States in Template Literals
**Learning:** This app uses raw HTML strings in TypeScript. Interactive elements like `.expand-btn` lacked focus states, making keyboard navigation difficult.
**Action:** When adding interactivity here, always verify keyboard focus. A shared `.focus-visible` CSS block (outline: 2px solid #38bdf8) works well for this dark theme.

## 2024-05-24 - Accessibility in Raw HTML Strings
**Learning:** Backend template strings bypass standard a11y linters. Found inputs missing labels and tables missing scopes.
**Action:** Manually audit raw HTML templates for `aria-label` on inputs and `scope` attributes on table headers during code review.

## 2024-05-25 - Accessible Canvas Charts
**Learning:** Chart.js canvases in raw HTML templates are invisible to screen readers by default. They need explicit `role="img"` and `aria-label` to provide context.
**Action:** Always add descriptive ARIA labels to canvas elements when generating HTML server-side, and update those labels client-side whenever chart data changes to keep them accurate.

## 2024-05-26 - Filter Persistence in Forms
**Learning:** Standard HTML forms reset URL parameters on submit, breaking user workflows when filters (like date ranges) are combined with search. Empty states rendered server-side and client-side (via hydration) can diverge.
**Action:** Always inject active filters as hidden `<input>` fields in search forms to ensure smooth, context-aware navigation. When updating server-side empty state logic, mirror the logic in client-side scripts to prevent UI inconsistencies.
