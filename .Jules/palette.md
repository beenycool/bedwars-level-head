# Palette Notes

## 2025-05-15 - Dual-Rendering Synchronization

**Learning:** This app uses a dual-rendering strategy for the stats dashboard. HTML generation logic exists in both server-side TypeScript and a client-side JavaScript string. Any UX change to the table structure must be applied in BOTH places to prevent UI flicker or inconsistency on updates.

**Action:** Always grep for the client-side equivalent (e.g., inside `updateDashboard`) when modifying server-side HTML templates.
