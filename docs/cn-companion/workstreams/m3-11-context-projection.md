# M3.11 Trusted Perception Context Projection

- Owner: Integration Owner (`/root`)
- Status: complete — context-only production slice accepted; reaction and actuation remain intentionally disabled pending the explicit user decision gate
- Scope: bounded perception projection, explicit context expiry/retraction, and the local-screen production bridge
- Files: `packages/stage-ui/src/domains/perception/context-projection*`, `packages/core-agent/src/runtime/context-registry*`, `packages/stage-ui/src/stores/chat/context-*`, `apps/stage-tamagotchi/src/renderer/{services,composables}/perception/*`
- Depends on: perception contract `perception/v0.3`, `PerceptionStateManager`, production local-screen vertical slice
- Contract version/commit: `perception/v0.3`; dirty working tree, no commit requested
- Verification: core registry/prompt 19/19; stage-ui perception/context 58/58; renderer perception 10/10; package typechecks and targeted lint pass; real Electron run proved fresh projection, privacy-pause retraction, stop retraction and loopback worker shutdown
- Handoff notes: context-only; reaction and actuation remain disabled. Summary-valued facts are omitted from prompts until a separately reviewed normalization policy exists. Root release gates remain a stage-level M3.13 obligation.
