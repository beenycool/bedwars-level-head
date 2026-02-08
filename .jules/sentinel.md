## 2024-05-22 - Manual CSP Implementation
**Vulnerability:** Weak/Broken CSP implementation using custom middleware instead of Helmet.
**Learning:** The project manually constructs CSP headers in `securityHeaders.ts`. This led to a state where inline scripts were likely blocked (or required `unsafe-inline` to work), but `unsafe-inline` was missing from the configuration.
**Prevention:** Prefer standard libraries like `helmet` which manage CSP intricacies (like nonce generation) more robustly. When using custom middleware, ensure nonces are generated and propagated to views.

## 2024-05-22 - CSV Formula Injection in Stats Export

**Vulnerability:** The `/csv` endpoint exported user-controlled data (usernames) without sanitization, allowing Formula Injection (CSV Injection) if the file is opened in Excel.
**Learning:** Standard CSV escaping (quotes) is insufficient for security; Excel executes formulas even in quoted fields if they start with `=`, `+`, `-`, `@`.
**Prevention:** Prepend a single quote `'` to any field starting with these characters to force text interpretation.

## 2025-02-14 - IGN Spoofing via Unverified Displayname in Fallback Validation
**Vulnerability:** The `verifyHypixelOrigin` fallback mechanism (used when signature is missing) verified numeric stats against Hypixel API but accepted the `displayname` from the user submission without verification. This allowed attackers to spoof their IGN in the cache/database by submitting their own valid stats but a fake name.
**Learning:** When validating data against a trusted source (like an API), ensure *all* fields that are used/stored are verified, not just a subset of "critical" fields. Partial validation can lead to partial trust, which can be exploited.
**Prevention:** Explicitly verify all user-submitted fields against the trusted source, or prefer using the data directly from the trusted source instead of the user submission when falling back.
