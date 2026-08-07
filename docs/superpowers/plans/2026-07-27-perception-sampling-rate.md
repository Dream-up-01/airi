# Perception Sampling Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Add independently selectable 1/2/5/10/30 Hz target sampling settings for desktop and camera perception, shared between each source's local and cloud lanes while preserving cloud safety caps.

**Architecture:** Keep rate semantics in the framework-independent perception domain. Store two validated non-sensitive renderer settings (`screen`, `camera`) in one shared composable, pass them to local/cloud coordinators, and let each running coordinator replace only its scheduler timer when the target changes. Existing gate, analyzer, consent, generation, resource, privacy, and state-manager policies remain authoritative.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, VueUse storage, Pinia/Vue composables, Vitest, Vue component/browser tests, UnoCSS, `packages/i18n` YAML resources.

---

## Task 1: Add the perception sampling domain contract

**Files:**
- Create: `packages/stage-ui/src/domains/perception/sampling.ts`
- Create: `packages/stage-ui/src/domains/perception/sampling.test.ts`
- Modify: `packages/stage-ui/src/domains/perception/index.ts`

- [x] **Step 1: Write the failing domain tests**

Add tests asserting the exact allowed tuple, parser behavior, source defaults, and interval conversion:

```ts
import { describe, expect, it } from 'vitest'

import {
  defaultPerceptionSamplingRate,
  parsePerceptionSamplingRate,
  PERCEPTION_SAMPLING_RATES,
  perceptionSamplingIntervalMs,
} from './sampling'

describe('perception sampling contract', () => {
  it('accepts only the five bounded rates', () => {
    expect(PERCEPTION_SAMPLING_RATES).toEqual([1, 2, 5, 10, 30])
    expect(parsePerceptionSamplingRate(30)).toBe(30)
    expect(parsePerceptionSamplingRate('10')).toBe(10)
    expect(parsePerceptionSamplingRate(3)).toBeUndefined()
    expect(parsePerceptionSamplingRate(Number.NaN)).toBeUndefined()
    expect(parsePerceptionSamplingRate('30.0')).toBeUndefined()
  })

  it('preserves current scheduler defaults by source', () => {
    expect(defaultPerceptionSamplingRate('screen')).toBe(2)
    expect(defaultPerceptionSamplingRate('camera')).toBe(10)
  })

  it('converts rates to integer intervals', () => {
    expect(perceptionSamplingIntervalMs(1)).toBe(1_000)
    expect(perceptionSamplingIntervalMs(2)).toBe(500)
    expect(perceptionSamplingIntervalMs(5)).toBe(200)
    expect(perceptionSamplingIntervalMs(10)).toBe(100)
    expect(perceptionSamplingIntervalMs(30)).toBe(34)
  })
})
```

- [x] **Step 2: Run the domain test and verify the expected missing-module failure**

Run `pnpm vitest run packages/stage-ui/src/domains/perception/sampling.test.ts`.
Expected: FAIL because `./sampling` does not exist.

- [x] **Step 3: Implement the minimal contract**

Define `PerceptionSamplingSource = 'screen' | 'camera'`, `PerceptionSamplingRate = 1 | 2 | 5 | 10 | 30`, the tuple, a `Record` of defaults, a strict parser accepting numeric values and integer strings only, and `Math.ceil(1000 / rate)` interval conversion. Export the symbols through the perception domain index.

- [x] **Step 4: Run the domain test and verify it passes**

Run the same Vitest command; expected: PASS.

## Task 2: Add shared validated renderer settings

**Files:**
- Create: `apps/stage-tamagotchi/src/renderer/composables/perception/use-perception-sampling-settings.ts`
- Create: `apps/stage-tamagotchi/src/renderer/composables/perception/use-perception-sampling-settings.test.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/App.vue`

- [x] **Step 1: Write the failing settings tests**

Test that the composable exposes two independent refs, normalizes invalid persisted values to defaults, and updates the matching source only. Stub storage with `vi.stubGlobal` using the same key format used by the composable.

```ts
it('keeps screen and camera rates independent and validates storage', () => {
  storage.setItem('settings/perception/sampling-rate/screen', '30')
  storage.setItem('settings/perception/sampling-rate/camera', 'bogus')
  const settings = createPerceptionSamplingSettings()
  expect(settings.screen.value).toBe(30)
  expect(settings.camera.value).toBe(10)
  settings.set('screen', 5)
  expect(settings.screen.value).toBe(5)
  expect(settings.camera.value).toBe(10)
})
```

- [x] **Step 2: Run the settings test and verify it fails**

Run `pnpm vitest run apps/stage-tamagotchi/src/renderer/composables/perception/use-perception-sampling-settings.test.ts`.
Expected: FAIL because the composable and factory are absent.

- [x] **Step 3: Implement storage-backed settings**

Use the existing VueUse `useStorage` pattern for `settings/perception/sampling-rate/screen` and `/camera`, but pass every loaded value through `parsePerceptionSamplingRate`; expose `screen`, `camera`, and `set(source, rate)`. Provide the settings from `App.vue` only for perception-capable routes and pass the shared instance to local/cloud perception providers. Keep storage values limited to the rate union.

- [x] **Step 4: Run the settings test and verify it passes**

Run the same command; expected: PASS.

## Task 3: Make local desktop scheduling rate-aware

**Files:**
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/local-screen-perception-coordinator.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/local-screen-perception-coordinator.test.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/composables/perception/use-local-screen-perception.ts`

- [x] **Step 1: Add failing tests for target rate and timer replacement**

Extend the existing fake timer factory to capture the interval and assert the default is 500 ms, `setSamplingRate(5)` clears the old timer and schedules 200 ms while the session remains running, and `stop()` clears the new timer. Add a test that an invalid rate passed to the setter is ignored at the typed boundary.

- [x] **Step 2: Run the targeted coordinator test and verify the new assertions fail**

Run `pnpm vitest run apps/stage-tamagotchi/src/renderer/services/perception/local-screen-perception-coordinator.test.ts`.
Expected: FAIL because no setter/status rate exists and the coordinator always schedules 500 ms.

- [x] **Step 3: Implement rate-aware scheduling**

Import the domain rate type and interval helper. Add `samplingRate` to status, initialize it from the options getter/default, add `setSamplingRate(rate)` that updates status and replaces only the active timer, and use the selected interval when starting. Keep the injected `setInterval`/`clearInterval` hooks so tests observe exact timer behavior. Expose `samplingRate` and `setSamplingRate` through `LocalScreenPerceptionContext`; watch the shared settings ref and call the coordinator setter.

- [x] **Step 4: Run the targeted coordinator/composable tests and verify they pass**

Run the coordinator test plus the new settings test; expected: PASS.

## Task 4: Make local camera scheduling rate-aware

**Files:**
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/local-camera-perception-coordinator.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/local-camera-perception-coordinator.test.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/composables/perception/use-local-camera-perception.ts`

- [x] **Step 1: Add failing tests for 10 Hz default and 30 Hz replacement**

Inject fake `setInterval`/`clearInterval` hooks, assert start schedules 100 ms, call `setSamplingRate(30)`, assert the old timer is cleared and 34 ms is scheduled, and assert analyzer submissions remain latest-slot bounded.

- [x] **Step 2: Run the targeted test and verify it fails**

Run `pnpm vitest run apps/stage-tamagotchi/src/renderer/services/perception/local-camera-perception-coordinator.test.ts`.
Expected: FAIL because scheduling is fixed at 100 ms and no setter exists.

- [x] **Step 3: Implement the minimal camera changes**

Add timer hooks to options, store the typed rate on the active run/coordinator, replace the timer idempotently on updates, expose `samplingRate` and `setSamplingRate` through the composable, and watch the shared camera setting. Do not change analyzer model Hz, YOLO cadence, resource priority, or frame ownership.

- [x] **Step 4: Run the targeted camera tests and verify they pass**

Run the camera coordinator test plus the shared settings test; expected: PASS.

## Task 5: Propagate target rates through cloud coordinators without bypassing caps

**Files:**
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-screen-coordinator.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-camera-coordinator.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-camera-frame-encoder.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-screen-coordinator.test.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-camera-frame-encoder.test.ts`
- Modify: `apps/stage-tamagotchi/src/renderer/composables/perception/use-qwen-cloud-perception.ts`

- [x] **Step 1: Write failing cloud propagation/cap tests**

Assert the screen coordinator starts with the shared target interval and replaces it after a runtime update. Assert the camera encoder receives high-rate local frames but `CameraCloudFrameGate` still accepts no more than one frame per second. Keep assertions on accepted/submitted counts, never raw payloads.

- [x] **Step 2: Run the targeted cloud tests and verify they fail**

Run `pnpm vitest run apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-screen-coordinator.test.ts apps/stage-tamagotchi/src/renderer/services/perception/qwen-cloud-camera-frame-encoder.test.ts`.
Expected: FAIL because cloud target-rate setters/options are absent.

- [x] **Step 3: Implement cloud target-rate propagation**

Add typed rate options/status fields and timer hooks to the cloud screen coordinator. Add a camera target-rate getter/setter/status field for observability; keep the encoder gate's maximum `1 FPS` unchanged and use the target only for admission attempts/change sampling. Pass the shared settings object from `provideQwenCloudPerception`, watching source-specific refs so local and cloud lanes update together.

- [x] **Step 4: Run the targeted cloud tests and verify they pass**

Run the two cloud test files; expected: PASS.

## Task 6: Wire the independent controls into all perception panels and translations

**Files:**
- Modify: `apps/stage-tamagotchi/src/renderer/components/perception/PerceptionControlSurface.vue`
- Modify: `apps/stage-tamagotchi/src/renderer/components/perception/LocalScreenPerceptionPanel.vue`
- Modify: `apps/stage-tamagotchi/src/renderer/components/perception/LocalCameraPerceptionPanel.vue`
- Modify: `apps/stage-tamagotchi/src/renderer/components/perception/CloudPerceptionPolicyPanel.vue`
- Modify: `packages/i18n/src/locales/en/tamagotchi/stage.yaml`
- Modify: `packages/i18n/src/locales/zh-Hans/tamagotchi/stage.yaml`
- Modify: `packages/i18n/src/locales/zh-Hant/tamagotchi/stage.yaml`
- Test: `apps/stage-tamagotchi/src/renderer/components/perception/PerceptionControlSurface.browser.test.ts`

- [x] **Step 1: Add failing browser assertions**

Extend the browser test to find the desktop and camera rate selects, choose `5` and `30`, switch to the cloud tab, and assert the corresponding session controls display the same values and the cloud cap explanation is visible. Assert all labels are translated through the test i18n fixture.

- [x] **Step 2: Run the browser test and verify it fails**

Run `pnpm vitest run apps/stage-tamagotchi/src/renderer/components/perception/PerceptionControlSurface.browser.test.ts`.
Expected: FAIL because no rate controls or translation keys exist.

- [x] **Step 3: Implement typed props/models and localized controls**

Use a native `<select>` with the five values, bind it to the shared source model, keep controls available during running, and render target/effective cadence text in the cloud session blocks. Add matching translation keys in all three locale files. Use props down/events up; no panel reaches into a coordinator.

- [x] **Step 4: Run the browser/component test and verify it passes**

Run the targeted browser test; expected: PASS.

## Task 7: Final integration verification

**Files:**
- Modify only files required by failing tests or type errors found in prior tasks.

- [x] **Step 1: Run all targeted perception tests**

Run the domain, settings, local screen, local camera, cloud screen, cloud camera, and control-surface test commands listed above; expected: all PASS.

- [x] **Step 2: Run repository typecheck**

Run `pnpm typecheck`; expected: exit code 0.

- [x] **Step 3: Run repository lint**

Run `pnpm lint`; expected: exit code 0 with only the repository's existing warning baseline.

- [x] **Step 4: Check patch whitespace and scope**

Run `git diff --check` and `git status --short`; expected: no whitespace errors, only the intended sampling-rate files plus pre-existing user changes.
