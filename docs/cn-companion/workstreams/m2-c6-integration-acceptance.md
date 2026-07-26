# M2-C6 integration and acceptance

- Owner: Integration Owner (`/root`)
- Status: automated integration, Electron lifecycle, and primary REST TTS pass; human audible/subjective V01–V15 sign-off pending.
- Fake full chain: ASR partial is caption-only; one final enters the normal M1 chat path once; one fake TTS/playback completes. Spoken injection and high-risk text retain M1 policy.
- Cancellation: listening/transcribing/thinking/TTS/playback stop paths, provider generations, stale results, audio queue cancellation, and recovery draft cleanup are covered by targeted tests.
- Cross-window UI: Eventa BroadcastChannel settings signals contain only allowlisted storage keys. A narrow runtime snapshot supplies provider IDs, capability, error code, bounded timings, and style warning codes to settings without transcript/audio/secret data.
- Electron evidence: Qwen service health `ok=true, streaming=true`; main-page microphone start created one active local ASR session and stop returned it to zero. Settings showed Qwen3-ASR + MiniMax, streaming ASR, REST/non-streaming TTS truth, conservative disabled modes, cloud-text acknowledgement, and no sensitive content.
- ASR real protocol: existing 4.78 s Chinese reference, 9 partials, first partial 727 ms, finalization 178 ms, 19 final characters, normalized exact reference match.
- MiniMax real probe: China endpoint plus configured account voice succeeded; first playable `715 ms`, playback `760 ms`, normal completion, explicitly REST/non-streaming. Turbo/HD/Turbo selection persisted correctly.
- Automated verification on 2026-07-14: stage-ui M2 `24/24` files and `136/136` tests; pipelines-audio `5/5` files and `40/40` tests; Desktop `3/3` files and `20/20` tests; Chromium `5/5` files and `10/10` tests; core M1/context `2/2` files and `21/21` tests; CCC/character regression `9` files passed, `54` tests passed, `1` intentionally skipped; root typecheck passed across selected `52` workspace projects; root lint `0` warnings/errors.
- Screenshots: `docs/cn-companion/qa-m2-main-2026-07-14.png`, `docs/cn-companion/qa-m2-main-expanded-2026-07-14.png`, and the retained 2026-07-13 settings evidence.
- Release gate: automated/operational evidence has no known P0/P1. Do not mark complete until a human listener completes the remaining audible/subjective V01–V15 judgments and final root typecheck/lint pass after all resulting changes.
