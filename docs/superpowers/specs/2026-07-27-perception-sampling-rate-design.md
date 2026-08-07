# Perception Sampling Rate Design

Date: 2026-07-27
Status: Draft for user review

## Goal

Add independently selectable observation frequencies for desktop and camera perception. Each source has one target frequency shared by its local and Qwen cloud lanes. The selectable values are 1, 2, 5, 10, and 30 observations per second.

The target frequency controls sampling attempts. It does not override the existing consent, privacy, resource, change-gate, provider cadence, cost, or publication policies. Cloud status must distinguish the target rate from accepted/submitted work.

## Scope and Defaults

- Desktop and camera settings are independent.
- The desktop setting is shared by local screen and cloud screen coordinators.
- The camera setting is shared by local camera and cloud camera coordinators.
- Allowed values are the closed set `1 | 2 | 5 | 10 | 30`.
- Defaults preserve current scheduler behavior as closely as possible: desktop 2 Hz and camera 10 Hz.
- Settings are non-sensitive configuration only and may be persisted; no frame, audio, OCR, model response, or provider secret is stored.

## Domain Contract

Add a framework-independent perception sampling contract with:

- the allowed rate tuple and `PerceptionSamplingRate` union;
- parsing/normalization that rejects unknown, fractional, non-positive, and non-finite values;
- per-source defaults;
- conversion from rate to integer timer interval;
- cloud policy metadata describing the maximum effective cadence without changing the existing provider gates.

The contract is exported from the perception domain and has unit tests. It must not import Vue, Electron, browser APIs, storage, or network code.

## Application State and Data Flow

The renderer perception application layer owns one reactive settings object per renderer. It persists two independent non-sensitive keys (`screen` and `camera`) using the existing storage pattern and validates every read. A storage update from another renderer is accepted only after the same domain parser succeeds.

The settings object is shared by the local and cloud composables in that renderer. The control surface passes the two values to both local and cloud panels. Updating a value calls the corresponding coordinator setter; no panel writes directly to a capture, analyzer, Eventa channel, context registry, or state manager.

The local and cloud coordinators receive a typed rate getter/setter boundary. A setter updates the target rate and, when running, replaces only the scheduler timer. It never changes session generation, consent grants, source ownership, or fact state.

## Runtime Behavior

### Local desktop

The capture attempt timer uses the selected desktop interval. Existing screen change-gate behavior remains authoritative for accepted frames, including sensitive-surface, source-health, visibility, significant-change, and cadence decisions.

### Local camera

The capture attempt timer uses the selected camera interval. MediaPipe, OpenCV, and YOLO retain their existing latest-slot, timeout, resource, and analyzer-specific limits. A high target rate cannot create an unbounded frame queue or bypass the sole `PerceptionStateManager` write path.

### Cloud desktop

The cloud capture attempt timer uses the selected desktop interval. Existing `ScreenChangeGate` normal/active cadence, cloud window backpressure, manual response control, cost guards, generation checks, and consent requirements remain unchanged. A target above the provider policy limit is surfaced as constrained rather than treated as an accepted upload rate.

### Cloud camera

The local camera frame stream is sampled at the selected camera target rate. `QwenCloudCameraFrameEncoder` and `CameraCloudFrameGate` remain authoritative for person presence, privacy mode, foreground, visual change, busy state, payload size, and the existing 1 FPS cloud maximum.

### Lifecycle and concurrency

Changing a rate while `starting`, `stopping`, `paused`, or `failed` updates configuration only. The next running session uses the latest valid value. Stop, pause, revoke, source end, generation change, unmount, and application exit clear the active timer and release existing resources as before. A stale result cannot be revived by a rate change.

## UI

`LocalScreenPerceptionPanel` and `LocalCameraPerceptionPanel` each receive a typed rate model and render a native select with localized labels for the five values. `CloudPerceptionPolicyPanel` renders the same screen and camera values in its respective session sections, so a user can set the desired rate before starting a cloud session.

The panels show the target rate alongside existing attempts/accepted/submitted counters. Cloud sessions include a localized explanation that provider policy may reduce the effective upload cadence. All new visible text is added to English, Simplified Chinese, and Traditional Chinese resources.

## Error Handling and Safety

- Invalid persisted values fall back to the source default.
- Timer replacement is idempotent and race-safe; no duplicate timer may remain after an update.
- A rate update never grants a new modality, expands consent, changes processing mode, or enables cloud upload.
- Raw frames, audio, OCR, model free text, paths, and secrets are never included in settings, status, logs, telemetry, context projection, or exports.
- Cloud policy caps are observable through bounded status/counter fields and stable localized text, not through provider errors or silent fallback.

## Verification

Targeted tests cover domain parsing/defaults, timer interval calculation, local desktop/camera timer replacement and cleanup, cloud target-rate propagation and cap preservation, panel model updates, shared local/cloud values, and i18n keys. Final gates are targeted Vitest, root `pnpm typecheck`, root `pnpm lint`, and `git diff --check`.

## Non-Goals

This change does not alter perception schemas, TTLs, analyzer models, provider model selection, microphone ownership, cloud retention verification, chat context semantics, reaction policy, Minecraft, or autonomous control.
