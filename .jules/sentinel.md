## 2024-05-24 - SQL Injection in Cockroach TTL
**Vulnerability:** SQL injection vulnerability via an unescaped raw string literal representing the table name in `sql.raw` in `ensureCockroachRowLevelTtl` within `cockroachTtl.ts`.
**Learning:** Raw SQL query strings often bypass Kysely's built-in protections if not using the tagged template literals correctly or quoting identifiers. When fixing SQL injection vulnerabilities by validating identifiers, standard validation regex (`/[^a-zA-Z0-9_]/`) can be overly strict and break functionality relying on schema-qualified tables (e.g. `schema.table`).
**Prevention:** Always escape standard SQL identifiers using `""` and doubling internal quotes `""`.
