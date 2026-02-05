## 2024-05-22 - Manual CSP Implementation
**Vulnerability:** Weak/Broken CSP implementation using custom middleware instead of Helmet.
**Learning:** The project manually constructs CSP headers in `securityHeaders.ts`. This led to a state where inline scripts were likely blocked (or required `unsafe-inline` to work), but `unsafe-inline` was missing from the configuration.
**Prevention:** Prefer standard libraries like `helmet` which manage CSP intricacies (like nonce generation) more robustly. When using custom middleware, ensure nonces are generated and propagated to views.
