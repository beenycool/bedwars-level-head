## 2024-05-22 - Manual CSP Implementation
**Vulnerability:** Weak/Broken CSP implementation using custom middleware instead of Helmet.
**Learning:** The project manually constructs CSP headers in `securityHeaders.ts`. This led to a state where inline scripts were likely blocked (or required `unsafe-inline` to work), but `unsafe-inline` was missing from the configuration.
**Prevention:** Prefer standard libraries like `helmet` which manage CSP intricacies (like nonce generation) more robustly. When using custom middleware, ensure nonces are generated and propagated to views.

## 2024-05-22 - CSV Formula Injection in Stats Export

**Vulnerability:** The `/csv` endpoint exported user-controlled data (usernames) without sanitization, allowing Formula Injection (CSV Injection) if the file is opened in Excel.
**Learning:** Standard CSV escaping (quotes) is insufficient for security; Excel executes formulas even in quoted fields if they start with `=`, `+`, `-`, `@`.
**Prevention:** Prepend a single quote `'` to any field starting with these characters to force text interpretation.
