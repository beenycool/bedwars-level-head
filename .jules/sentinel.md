## 2024-05-24 - SQL Injection in Cockroach TTL
**Vulnerability:** SQL injection vulnerability via an unescaped raw string literal representing the table name in `sql.raw` in `ensureCockroachRowLevelTtl` within `cockroachTtl.ts`.
**Learning:** Raw SQL query strings often bypass Kysely's built-in protections if not using the tagged template literals correctly or quoting identifiers. When fixing SQL injection vulnerabilities by validating identifiers, standard validation regex (`/[^a-zA-Z0-9_]/`) can be overly strict and break functionality relying on schema-qualified tables (e.g. `schema.table`).
**Prevention:** Always escape standard SQL identifiers using `""` and doubling internal quotes `""`.

## 2026-04-09 - Fix SQL Injection and Raw Interpolation Vulnerabilities in Cache Service
**Vulnerability:** Found multiple methods in `cache.ts` using raw template literals vulnerable to syntax mangling or injection:
1. `getActivePrivateUserCount` and `getPrivateRequestCount` passed a bare `since` parameter directly into a Kysely `sql` tagged literal without any SQL query structure (e.g. `sql\`${since}\``), treating the raw number as the query itself.
2. `deleteCacheEntries` passed an array of strings (`keys`) directly into a raw SQL `IN (${keys})` clause. Depending on the driver, this can cause a syntax error or lead to SQL injection vulnerabilities because Kysely's raw template literals do not safely expand and parameterize arrays into CSV format for `IN` clauses without the explicit `sql.join` helper.

**Learning:** When using Kysely's `sql` tagged literals, arrays must not be passed natively to `IN` clauses because the driver cannot properly escape or expand them. Furthermore, raw variables must never constitute the entire query string.

**Prevention:** Always use Kysely's query builder (e.g. `db.deleteFrom().where(col, 'in', array)`) for `IN` clauses to ensure dialect-agnostic array parameterization. For raw queries, ensure the parameterized variables are strictly enclosed within valid SQL commands (e.g., `SELECT SUM(count) FROM table WHERE col >= ${val}`).
