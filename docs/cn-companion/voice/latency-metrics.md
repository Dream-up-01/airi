# M2 voice latency and privacy metrics

Last evidence update: 2026-07-14.

M2 needs one timeline per voice session and one timeline per spoken turn. Metrics must be useful for latency debugging without collecting sensitive content.

## Correlation keys

- `sessionId`: one user-visible voice conversation lifecycle.
- `turnId`: one spoken user turn and the assistant response that follows.
- `providerId`, `modelId`, `voiceId`: allowed when they are configuration identifiers, not secrets.

Do not use raw transcript, prompt text, audio hashes, local paths, API keys, or provider tokens as correlation keys.

## Required events

| Event | Owner | Notes |
| --- | --- | --- |
| `voice.session.start` | voice conversation store | User requested voice mode. |
| `voice.permission.requested` | platform/audio device layer | No device label unless already permission-safe. |
| `voice.permission.granted` | platform/audio device layer | Record timing only. |
| `voice.permission.denied` | platform/audio device layer | Record bounded error code. |
| `voice.vad.started` | VAD/session layer | Include selected mode and thresholds, not audio. |
| `voice.vad.speech_start` | VAD/session layer | Start of detected user speech. |
| `voice.vad.speech_end` | VAD/session layer | End of detected user speech. |
| `voice.asr.started` | hearing layer | Include ASR provider/model IDs. |
| `voice.asr.first_partial` | hearing layer | Include elapsed time and bounded character count only. |
| `voice.asr.final` | hearing layer | Include elapsed time and final character count only. |
| `voice.chat.ingested` | chat orchestration | ASR text accepted into normal chat path. |
| `voice.llm.first_token` | chat orchestration | LLM TTFT boundary. |
| `voice.llm.completed` | chat orchestration | Assistant text stream ended. |
| `voice.tts.first_request` | speech layer | First TTS request or streaming append. |
| `voice.tts.first_audio` | speech layer | First decoded/scheduled audio buffer. |
| `voice.playback.started` | playback manager | Audible playback began. |
| `voice.playback.completed` | playback manager | Audible playback ended normally. |
| `voice.cancelled` | voice conversation store | Low-cardinality cancellation reason. |
| `voice.failed` | voice conversation store | Low-cardinality error code. |

## Derived timings

| Metric | Formula | Target for M2 validation |
| --- | --- | --- |
| Permission latency | permission result - permission requested | Informational |
| Speech segment duration | VAD speech end - VAD speech start | Informational |
| ASR first partial latency | ASR first partial - VAD speech start | < 800 ms when provider supports streaming partials |
| ASR final latency | ASR final - VAD speech end | < 1200 ms for short utterances |
| Chat ingest latency | chat ingested - ASR final | < 300 ms |
| LLM TTFT | LLM first token - chat ingested | Provider-dependent |
| TTS first request latency | TTS first request - LLM first token | < 300 ms |
| TTS first audio latency | TTS first audio - TTS first request | < 1500 ms streaming, < 2500 ms REST |
| Playback start latency | playback started - TTS first audio | < 300 ms |
| Stop latency | audible playback stopped - explicit stop | < 300 ms |

Targets are provider-matrix thresholds, not universal guarantees. If a provider cannot meet them, document the provider limitation instead of hiding the slow path.

## 2026-07-14 measured evidence

| Lane | Measurement | Result | Status |
| --- | --- | --- | --- |
| Qwen3-ASR local stream | 4.78 s Chinese reference, first accepted partial from first paced audio chunk | 727 ms | pass against `<800 ms` |
| Qwen3-ASR local finish | `finish` request after final audio chunk to authoritative final | 178 ms | pass against `<1200 ms` |
| Qwen3-ASR lifecycle | real Electron microphone start/stop, service active session count | `0 -> 1 -> 0` | cleanup pass |
| MiniMax China REST | request to fetch response / returned audio attachment for `speech-2.8-turbo` / configured account voice | 633 ms / 665 ms | pass; complete returned payload is used before playback |
| MiniMax China REST first playable | request to browser `canplay`/`loadeddata` after complete response | 715 ms | pass against REST `<2500 ms`; not true streaming |
| MiniMax China REST playback | request to actual `playing` event / generated audio duration | 760 ms / 1,103 ms | playback pass; completed at 2,369 ms from request start |
| MiniMax model/profile switch | settings selection and persisted voice-conversation profile | Turbo → HD → Turbo | pass; selected model ID changed without exposing credentials |
| Cloud acknowledgement revocation | active Qwen stream and MiniMax-ready profile | Qwen active sessions `1 -> 0` | pass; voice start blocked until acknowledgement restored |

The Qwen reference produced nine incremental results, a 19-character final, and a normalized exact match to its local reference transcript. A separate 2026-07-14 Electron start/stop repeated the `0 -> 1 -> 0` lifecycle. The transcript and synthesized text are not copied into the timing log.

## Privacy rules

Allowed by default:

- Provider ID, model ID, voice ID.
- State/event names.
- Timing values.
- Bounded character counts.
- Low-cardinality error codes and cancellation reasons.
- Whether a provider supports streaming ASR/TTS.

Disallowed by default:

- Raw microphone audio.
- Full ASR transcript.
- Full assistant response.
- Full prompt/system prompt.
- API keys, Bearer/JWT tokens, access tokens.
- Local filesystem paths.
- Uploaded document text or hashes from character-source import jobs.

Developer/debug UI may show redacted transcript snippets only when the user explicitly opens debug mode.
