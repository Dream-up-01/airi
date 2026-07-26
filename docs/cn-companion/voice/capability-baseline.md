# M2 voice capability baseline

Date: 2026-07-15
Scope: Desktop `stage-tamagotchi` and shared stage packages.
Working tree: branch `codex/m0-m1-cn-companion`, based on commit `c5e3f4aea1d3585b6812c1f393188fc0f2851728`; no commit requested.

## Production chain

The Desktop main page uses one microphone stream and the existing hearing/chat/speech chain:

```text
permission request/grant
  -> microphone + VAD
  -> Qwen3-ASR streaming or SenseVoice recording fallback
  -> one correlated final transcript
  -> existing chat sync and M1 policy
  -> existing LLM stream
  -> bounded voice style
  -> configured speech output profile
  -> existing playback manager
  -> caption, lip sync, and minimal Stage actuation
```

There is no second chat history, transcript history, or playback path. Partial ASR is caption-only; only one authoritative final creates a normal user turn.

## Session, permission, timeline, and cancellation

- `VoiceConversationSession` is the framework-independent legal state machine. Stale turn/generation events are rejected.
- Production start records `requesting-permission` before device IO, then grant/deny. Track end and permission changes revoke the session.
- Timeline events correlate `sessionId`/`turnId` and contain only event names, timestamps, bounded lengths, provider configuration IDs, error codes, and cancellation reasons.
- Stop, interrupt, provider switch, page disposal, playback echo gating, and stale ASR/TTS generations cancel their owned work.
- A 2026-07-13 Electron run observed Qwen server sessions `0 -> 1 -> 0` across start/stop.

## Preferences and diagnostics

- Supported modes: `vad-turn-taking` and `streaming-asr`. `push-to-talk` is visible but disabled until a production press/release surface exists.
- Supported interruption: `disabled` and `pushToInterrupt`. `vadBargeIn` remains disabled because an independently testable echo reference and false-positive guard are not available.
- VAD threshold, minimum speech, and trailing silence are bounded by the domain before persistence. The natural-pause default is 1,600 ms; legacy v1 preferences using the former 800 ms default migrate once to v2 while preserving the other bounded choices.
- Cloud acknowledgement is enforced by the production readiness gate: MiniMax voice cannot start before acknowledgement, and withdrawing it stops current playback/input and closes the local ASR session. Microphone audio remains local for M2.
- The settings and main BrowserWindows synchronize allowlisted configuration keys using Eventa's BroadcastChannel adapter. Values and provider credentials never cross this transport.
- Runtime diagnostics are a separate narrow Eventa snapshot: provider/model/voice IDs, capability enum, error code, bounded latency values, and allowlisted style warning codes only.

## ASR profiles

| Role | Provider / model | Input | Capability | 2026-07-13 evidence |
| --- | --- | --- | --- | --- |
| Primary | `qwen3-asr-local` / `Qwen/Qwen3-ASR-0.6B` | 16 kHz mono chunks, local WSL2 | true stream input, incremental text, VAD `finish` | 4.78 s Chinese reference: 9 partials, first partial 727 ms, finish 178 ms, 19 final characters, normalized reference match true |
| Fallback | `sensevoice-local` / `sensevoice-small` | recorded audio, local | record-then-transcribe | provider adapter and fallback configuration tests pass; prior local real synthesis/transcription baseline retained |

Qwen microphone audio never leaves the local loopback service. Empty/short filler and stale finals are filtered before chat.

The hearing settings keep both declared local ASR profiles visible even when Qwen is stopped. Selecting either declared card performs start, forced health validation, and configuration commit as one transaction; a failed start/validation keeps the previous ASR profile unchanged. The one-click launcher delegates cold-start SenseVoice ownership to the Electron manager. After a successful same-class switch, the manager closes the previous AIRI-owned local ASR; real Electron checks observed 8765 close on SenseVoice → Qwen and 8001 close on Qwen → SenseVoice. It never kills an arbitrary external process that happens to own the configured loopback port.

## TTS profiles

| Context | Provider / model / voice | Capability | Current evidence |
| --- | --- | --- | --- |
| Voice conversation primary | `minimax-speech` / `speech-2.8-turbo` / `AiriFireflyCN20260710_2011R7` | complete HTTP MP3 response, then decode/play; not true streaming | Real China REST request: fetch response resolved 633 ms, returned audio attached 665 ms, first playable 715 ms, playback start 760 ms, 1,103 ms audio; passes the REST `<2500 ms` target |
| Typed-chat fallback | `gpt-sovits-local` / `airi-firefly-v4` | complete local WAV response; not true streaming | loopback health and short real WAV synthesis were previously verified; targeted provider tests pass |

MiniMax TTS receives only assistant text after M1 output checks. API keys remain in the existing local provider credential store and never enter profiles, timeline, diagnostics, cards, or logs.

The speech model selector updates the voice-conversation routing profile as well as the visible active model. MiniMax HD/Turbo switches preserve the already validated account voice, and the existing provider-generation watcher cancels the prior TTS/playback intent before the new profile is used. Selecting local GPT-SoVITS starts and validates its loopback bridge before commit; switching away closes it when AIRI owns the child process. MiniMax has no resident local service to terminate.

## Recovery, style, and Stage

- A finalized ASR turn whose chat ingestion fails becomes an editable runtime-only draft. Retry replaces the failed correlated turn rather than appending a duplicate. Stop, success, provider switch, or discard clears it.
- `VoiceStyleDirective` is derived from M1 risk/scenario, trusted card speech binding, explicit user controls, mode, and provider capability. Values are clamped; crisis delivery cannot become faster/louder.
- Unsupported styles degrade to neutral/warm. SSML is code-generated and model text is escaped.
- `StageActuationIntentLite` can express only listening/thinking/speaking/interrupted/idle plus a bounded emotion hint; it cannot change personality, prompts, motion IDs, expression IDs, tools, or TTS text.

## Automated verification snapshot

- 2026-07-15 second-pass increment: stage-ui voice/provider `20` files / `103` tests; pipelines-audio `3` files / `34` tests; local service manager `1` file / `7` tests; declared local ASR Chromium component `1` file / `2` tests; core-agent M1 orchestration `1` file / `15` tests; all passed. Focused Desktop/stage-pages typechecks passed.
- stage-ui targeted voice/M1/provider run: `25` files, `141` tests passed.
- pipelines-audio cancellation/chunking: `5` files, `40` tests passed.
- Desktop local-service/chat-sync lifecycle: `4` files, `22` tests passed.
- Chromium settings components: `5` files, `7` tests passed.
- core M1 orchestration/context: `3` files, `31` tests passed.
- CCC and stage-ui character/M1 import/export regressions: `13` files, `88` tests passed.
- root `pnpm typecheck`: passed across the selected `52` package/app/docs workspace projects; root `pnpm lint`: `0` warnings and `0` errors.

## Open release gates

Human acceptance currently stands at 13/15: V01–V06 and V08–V14 pass. V07 and V15 failed in the second human round, received a second implementation pass, and now have supporting component/typecheck/real-Electron evidence. The remaining external release gate is the human audible retest of only V07 and V15.
