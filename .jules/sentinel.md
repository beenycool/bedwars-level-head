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

## 2025-05-18 - Unauthenticated CPU Exhaustion DoS in Admin Routes
**Vulnerability:** The `enforceAdminAuth` middleware (which performs CPU-intensive PBKDF2 hashing) was placed *before* the `enforceRateLimit` middleware in sensitive routes like `admin.ts` and `apikey.ts`.
**Learning:** Middleware order is critical for security. CPU-intensive operations (like password hashing or heavy crypto) must always be protected by rate limiting to prevent attackers from exhausting server resources with invalid requests.
**Prevention:** Always place rate limiting middleware as early as possible in the request processing pipeline, especially before any resource-intensive authentication or validation steps.

## 2026-02-18 - CPU Exhaustion via PBKDF2 in API Key Validation

**Vulnerability:** The `validateAdminToken` and `validateCronToken` functions used `crypto.pbkdf2Sync` with 10,000 iterations for *every* request to validate API keys. This allowed an attacker to exhaust server CPU resources by sending many requests with invalid tokens, causing a Denial of Service (DoS).
**Learning:** While PBKDF2 is excellent for password storage (where slowness is a feature), it is inappropriate for high-throughput API key validation. API keys are typically high-entropy random strings that don't need salt/iterations to prevent rainbow table attacks in the same way user passwords do.
**Prevention:** Use fast cryptographic hashes for API key validation. We initially tried **HMAC-SHA256**, but static analysis tools (CodeQL) flagged it as insecure password hashing. We switched to **Scrypt** with minimal parameters (`N=16`), which is a recognized password hashing function (satisfying CodeQL) but tuned to be extremely fast (~0.03ms) to prevent CPU DoS.

## 2026-02-28 - Regex and Object Allocation DoS via Unbounded Input Limits

**Vulnerability:** Core functions and route handlers processing external identifiers (`resolvePlayer`, `/batch`, and `/cache/purge`) lacked explicit input length validation *before* operations like regex matching, string transformation (`.toLowerCase()`), or array `.map()` / `.trim()`. An attacker could exploit this by sending arbitrarily large string payloads (e.g. up to Express limit, ~64kb to 1MB) which exponentially ties up Node.js single-threaded event loop.
**Learning:** Checking payload size on raw HTTP requests is not a silver bullet because nested data or array inputs might bypass simple global filters. Validation limits on string length must be explicitly asserted in specific routing context logic and individual core domain handlers before expensive runtime allocations occur.
**Prevention:** Always enforce strict length bounding directly on parameter inputs prior to data manipulation, such as standardizing maximum characters (e.g., 64 characters) for player identifiers.
