# Draft: OpenAPI spec into mod + backend

## Requirements (stated)
- Add `openapi.json` to the Minecraft mod and the backend.

## Current Context
- `openapi.json` exists at repo root: `openapi.json`.
- Need to identify where "mod" and "backend" live in this repo and how they are built/package resources.

## Working Interpretation (until codebase confirms)
- Backend: expose/ship the OpenAPI document (e.g., served as a static file or at a route like `/openapi.json`) as part of the backend artifact.
- Mod: bundle the OpenAPI document into the mod JAR resources (or generate/use a client from it) depending on existing patterns.

## Open Questions
- What does "add it" mean for the mod: bundle the JSON as a resource vs generate a typed client from it vs just include for reference?
- What backend framework is used, and does it already have an OpenAPI/Swagger route?

## Scope Boundaries
- INCLUDE: wiring/build/resource changes needed so both artifacts contain/expose the spec.
- EXCLUDE (unless requested): redesigning endpoints, changing API behavior, adding new endpoints beyond spec hosting.
