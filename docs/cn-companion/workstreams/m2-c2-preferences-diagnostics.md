# M2-C2 preferences diagnostics

- Owner: Integration Owner (`/root`)
- Status: automated and Electron cross-window verification passed; final human audible matrix pending.
- Scope: Framework-agnostic voice preferences, bounded persistence, and settings diagnostics UI.
- Files: `packages/stage-ui/src/domains/voiceConversation/preferences.ts`, its tests and exports, `packages/stage-ui/src/stores/voiceConversationPreferences.ts`, its tests and exports, new voice settings components under `packages/stage-pages`, hearing route composition, and English/Simplified Chinese i18n keys.
- Depends on: M2 voice session/provider capability baseline and M2-C1 timeline.
- Contract version/commit: Working-tree M2 baseline; no commit requested.
- Verification: Chromium covers preferences, diagnostics, MiniMax settings, and main-stage recovery interactions (`5` files, `10` tests); bounded domain/store behavior is included in the `136`-test stage-ui M2 run. Real Electron settings showed the effective ASR/TTS identifiers, streaming/REST truth, conservative disabled modes, privacy acknowledgement, and no transcript/audio. Revoking acknowledgement stopped the active lane; restoring it allowed a clean restart. Eventa-over-BroadcastChannel signals only allowlisted storage keys; provider secrets never cross the transport. Runtime diagnostics now reject control characters, credential markers, token-like strings, URLs, traversal, Windows/UNC and common local absolute paths.
- Handoff notes: Conservative defaults; `vadBargeIn` remains opt-in and no unsupported runtime behavior may be advertised as active.
