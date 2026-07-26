# M3.8 Camera Local

- Owner: Codex `/root`
- Status: review — production local slice and three-analyzer real-device gate passed; expanded M3.13 scenario matrix remains
- Scope: camera consent/session/single owner、MediaPipe/OpenCV/YOLO local analyzer、fusion、生产 UI、真实设备验收
- Files: camera-specific modules under `packages/stage-ui/src/domains/perception/`, `packages/stage-ui/src/services/perception/`, `apps/stage-tamagotchi/src/renderer/composables/perception/`, `apps/stage-tamagotchi/src/renderer/components/perception/`, camera Eventa shared boundary if required, targeted settings/i18n integration, this workstream and provider profile
- Depends on: `perception/v0.3`、`PerceptionStateManager`、Web Lock owner、existing `@proj-airi/model-driver-mediapipe`、approved OpenCV.js 4.13.0 and YOLOX-Nano ONNX
- Contract version/commit: `perception/v0.3`; dirty shared worktree, no commit requested
- Verification: fixture analyzer tests、session/owner/fusion integration、component/Electron browser、real camera、privacy scan、root typecheck/lint/build
- Handoff notes: raw frames/landmarks/bboxes remain memory-only; no cloud/audio/reaction scope; OpenCV/YOLO artifact download was explicitly approved on 2026-07-16

## 2026-07-16 handoff

- Fixed and verified OpenCV.js 4.13.0 and YOLOX-Nano 0.1.1rc0 artifacts; sizes, SHA-256 and Apache-2.0 notices are recorded.
- The production Electron build contains the explicit MediaPipe SIMD WASM loader/binary and all three task assets; the first-frame-only WASM packaging failure is fixed.
- Real Windows camera run: all three analyzers `ready`, 101 working frames / 36 dropped / 5 fresh facts in the recorded window, sustained past 404 frames without degradation.
- Pause/stop revoke accepted facts and projection, dispose all analyzer lanes, and ignore late callbacks after the active run is cleared.
- Targeted camera domain/analyzer/coordinator/capture tests pass; app and MediaPipe typechecks, targeted lint and production build pass.
- Evidence: `docs/cn-companion/perception/qa-camera-three-analyzers-ready.png` and `camera-local-selection.md`.
- The Settings home page now exposes a localized `可信感知` entry. A second real-user acceptance pass reached 177+ working frames and six fresh facts with all three analyzers ready; the bounded inspector displayed confidence, age, TTL, provenance and suppression reasons.
- Acceptance-driven fixes: pause clears accepted facts/analyzer readiness atomically; indicator-driven stop clears the consent checkbox; stop clears analyzer error codes so timeout/degradation callbacks cannot survive the revoked generation.
- Final early/normal stop verification waited beyond analyzer timeout and showed no stale `camera-analyzer-timeout`, no fresh facts and no retained grant.

## Component map

- `CameraLocalSettingsPanel.vue`: presentation-only status/actions; reads bounded store state and emits explicit user actions.
- `CameraLocalIndicator.vue`: persistent capture/pause state and global stop affordance; no analyzer logic.
- `useCameraLocalPerception.ts`: renderer composition surface for session, owner, track and orchestrator lifecycle.
- framework-free camera services/domain modules: scheduling, evidence narrowing, fusion, thresholds and cleanup.
