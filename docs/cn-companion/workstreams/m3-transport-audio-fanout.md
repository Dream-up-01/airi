# m3-transport-audio-fanout

- Owner: Electron Transport / Audio Capture Boundary
- Status: complete — M3.4 transport/fanout exit conditions verified; real Provider gateway remains intentionally deferred to M3.7/M3.9
- Scope: M3.4 shared Eventa media stream contract, strict wire validation, fake PCM/JPEG transport spike, production `SharedMicrophoneCaptureOwner`, `AudioFanoutHub`, echo/backpressure/cancellation tests and quantitative report
- Files: `apps/stage-tamagotchi/src/shared/eventa/perception.ts`, its contract tests, `packages/stage-ui/src/services/perception/**`, `docs/cn-companion/perception/transport-spike.md`, minimal export/barrel updates
- Depends on: `perception/v0.3`, existing canonical voice input and playback echo gate; existing microphone capture behavior remains frozen
- Safety boundary: the frozen canonical voice path now leases its existing `getUserMedia` stream through the shared owner; no Provider WebSocket, API key, cloud request, production chat/context wiring or raw media broadcast was added
- Verification: targeted Vitest, stage-ui/tamagotchi typecheck, scoped ESLint and diff check
- Evidence: 25 M3.4 targeted tests cover strict Eventa edges, fake bidi PCM/JPEG, Abort propagation, independent bounded queues, echo gate, a single physical stream for canonical/cloud leases, permission revoke, late startup isolation and last-subscriber cleanup. Real hidden-window Electron IPC benchmark: 140.80MiB/s, 36.113ms p95, 1,649,436-byte main heap delta, 90/90 post-cancel messages dropped
- Handoff: M3.9 may obtain a cloud-audio lease only through `acquirePerceptionStream` with a strict, separate cloud microphone grant, then connect its PCM formatter to `AudioFanoutHub`; it must not call `getUserMedia` or alter the canonical subscriber lifecycle
