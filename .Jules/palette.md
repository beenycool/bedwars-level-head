## 2024-05-23 - Focus States in Template Literals
**Learning:** This app uses raw HTML strings in TypeScript. Interactive elements like `.expand-btn` lacked focus states, making keyboard navigation difficult.
**Action:** When adding interactivity here, always verify keyboard focus. A shared `.focus-visible` CSS block (outline: 2px solid #38bdf8) works well for this dark theme.
