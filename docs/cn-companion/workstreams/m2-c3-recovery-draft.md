# M2-C3 recoverable ASR draft

- Owner: Integration Owner (`/root`)
- Status: automated and Chromium component verification passed; provider-matrix human acceptance pending.
- Scope: Runtime-only editable draft after a finalized ASR turn fails in normal chat, with correlated and idempotent retry/discard behavior.
- Production behavior: cancel-before-final creates no draft or message; a chat failure retains only the finalized user text in memory; edit/retry replaces the original failed user turn instead of appending a duplicate; success, stop, provider switch, or explicit discard clears the draft.
- Privacy: the draft is not persisted, logged, placed in the timeline, or exported. Error logging records character count rather than transcript content.
- Verification: recovery domain/store tests and chat-sync contract tests are included in the 2026-07-14 stage-ui M2 run (`24` files, `136` tests); Chromium verifies edit/retry/discard on the production main-stage component; Desktop chat sync/lifecycle tests pass (`3` files, `20` tests).
- Contract version/commit: working tree based on `c5e3f4aea1d3585b6812c1f393188fc0f2851728`; no commit requested.
