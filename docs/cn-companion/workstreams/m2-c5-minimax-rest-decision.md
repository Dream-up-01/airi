# M2-C5 MiniMax transport decision

- Owner: Integration Owner (`/root`)
- Status: REST profile implemented, honestly declared, and measured below the M2 REST first-audio target.
- Decision date: 2026-07-14.
- Current profile: synchronous MiniMax T2A v2 HTTP on the configured China endpoint, `speech-2.8-turbo`, complete MP3 response before WebAudio decode/playback. This is not true streaming.
- Repository audit: Desktop already depends on `crossws` and Eventa. The current crossws client constructor accepts URL/protocols but not the required custom `Authorization` handshake header. The existing Stage pipeline also decodes a complete `ArrayBuffer`; a WebSocket alone would not provide safe progressive playback.
- Dependency decision: no new runtime dependency was added. A main-process WebSocket plus directed Eventa audio contract remains a separate user decision if the REST target cannot be met.
- Cancellation: stop, interrupt, provider/voice switch, unmount, and stale generation invalidate queued output and old playback intent.
- Real probe: the configured China endpoint and account voice `AiriFireflyCN20260710_2011R7` succeeded with `speech-2.8-turbo`: fetch response resolved `633 ms`, returned audio attached at `665 ms`, first playable `715 ms`, actual playback `760 ms`, duration `1,103 ms`, normal completion. This passes REST `<2500 ms` and remains explicitly non-streaming. Real settings also persisted HD and then restored Turbo, proving the selected model is no longer ignored.
- Official protocol references: [MiniMax China HTTP T2A](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http), [MiniMax WebSocket T2A](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket), and [MiniMax Get Voice](https://platform.minimax.io/docs/api-reference/voice-management-get).
