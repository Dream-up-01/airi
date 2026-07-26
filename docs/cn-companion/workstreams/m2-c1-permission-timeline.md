# M2-C1 permission timeline

- Owner: Integration Owner (`/root`)
- Status: automated and Electron lifecycle verification passed; final human audible matrix pending.
- Scope: Production microphone permission ordering, revocation handling, and privacy-safe voice timeline correlation.
- Files: `packages/stage-ui/src/stores/settings/audio-device.ts`, `packages/stage-ui/src/stores/settings/audio-device.test.ts`, `packages/stage-ui/src/domains/voiceConversation/session.ts`, `packages/stage-ui/src/domains/voiceConversation/session.test.ts`, `packages/stage-ui/src/domains/voiceConversation/timeline.ts`, `packages/stage-ui/src/domains/voiceConversation/timeline.test.ts`, `packages/stage-ui/src/stores/voiceConversation.ts`, `packages/stage-ui/src/stores/voiceConversation.test.ts`, `apps/stage-tamagotchi/src/renderer/pages/index.vue`
- Depends on: Existing M2 voice session/domain baseline in the current working tree.
- Contract version/commit: Working-tree M2 baseline; no commit requested.
- Verification: permission/state/timeline coverage is included in the 2026-07-14 stage-ui M2 run (`24` files, `136` tests). A real Electron grant/start/stop run established a Qwen session (`active_sessions` `0 -> 1 -> 0`) and cleaned it on stop. With an active session, withdrawing cloud TTS acknowledgement also closed Qwen (`1 -> 0`). Denial/revocation branches remain automated; a fresh OS prompt cannot be truthfully re-created after the user has already granted device permission.
- Handoff notes: Do not modify unrelated M0/M1 changes or replace the shared microphone stream lifecycle.
