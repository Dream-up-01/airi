# m3-foundation-contracts

- Owner: Integration / Perception Contract / State Policy
- Status: completed (2026-07-16)
- Scope: M3.0–M3.3 baseline audit, wire-safe domain contracts, strict parsers, session/consent lifecycle, state manager, deterministic fixtures and tests
- Files: `docs/cn-companion/perception/**`, `docs/cn-companion/tests/perception-acceptance-v0.3.md`, `packages/stage-ui/src/domains/perception/**`, minimal `packages/stage-ui/package.json` export
- Depends on: frozen M1/chat/voice upstream; existing screen capture, vision, context and Minecraft implementations are read-only inputs for the audit
- Contract version/commit: `perception/v0.3`; working tree baseline, no commit requested
- Verification: 32 targeted Vitest assertions passed across perception and package export contracts; `@proj-airi/stage-ui` typecheck passed; scoped ESLint passed; scoped tracked-file `git diff --check` passed
- Handoff notes: proceed to M3.4 Eventa transport spike and `AudioFanoutHub`. No production source adapter, raw media transport, cloud connection, UI or downstream context wiring was added in this workstream
