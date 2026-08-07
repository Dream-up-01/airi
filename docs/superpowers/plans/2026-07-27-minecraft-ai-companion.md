# Minecraft AI Companion Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic Phase A domain contracts and policy boundary for an AIRI-controlled Minecraft virtual player without connecting an executor or allowing real-player automation.

**Architecture:** Add an isolated `minecraft-companion` domain in `stage-ui` containing versioned contracts, strict Valibot parsers, risk/consent policy, and an intent lifecycle controller. The controller is the only Phase A entry point for goal/action admission; transport and executor adapters consume its validated output later. Server profiles remain explicit and PCL is treated only as a launcher.

**Tech Stack:** TypeScript, Valibot, Vitest, existing `@proj-airi/stage-ui` domain export conventions.

---

## Tasks

### Task 1: Freeze the Phase A public contract surface

**Files:**
- Create: `packages/stage-ui/src/domains/minecraft-companion/contracts.ts`
- Create: `packages/stage-ui/src/domains/minecraft-companion/errors.ts`
- Create: `packages/stage-ui/src/domains/minecraft-companion/index.ts`
- Modify: `packages/stage-ui/package.json` (add `./domains/minecraft-companion` export)
- Test: `packages/stage-ui/src/domains/minecraft-companion/contracts.test.ts`

- [x] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest'

import {
  MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION,
  MINECRAFT_COMPANION_CONTRACT_VERSION,
  minecraftActionRiskClasses,
  minecraftAgentActionKinds,
  minecraftIntentStates,
  minecraftStableErrorCodes,
} from './index'

describe('Minecraft companion Phase A contracts', () => {
  it('freezes the two wire lanes and first low-risk action allowlist', () => {
    expect(MINECRAFT_COMPANION_CONTRACT_VERSION).toBe('minecraft-companion/v1')
    expect(MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION).toBe('minecraft-agent-control/v1')
    expect(minecraftAgentActionKinds).toEqual([
      'look-at',
      'move-to-player',
      'follow-player',
      'jump',
      'send-chat',
      'select-hotbar',
    ])
    expect(minecraftActionRiskClasses).toEqual(['low', 'medium', 'high', 'prohibited'])
    expect(minecraftIntentStates).toEqual([
      'proposed',
      'awaiting-approval',
      'approved',
      'executing',
      'completed',
      'failed',
      'cancelled',
      'expired',
      'rejected',
    ])
    expect(minecraftStableErrorCodes).toContain('arbitrary-command-forbidden')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/contracts.test.ts`

Expected: FAIL because the new domain exports do not exist yet.

- [x] **Step 3: Add the minimal versioned types and constants**

Define the contract versions, action/risk/intent/error literal arrays, `MinecraftGoal`, `MinecraftAgentAction` discriminated union, `MinecraftActionProposal`, `MinecraftActionResult`, and lifecycle result types. Keep action parameters bounded and structured; do not include raw LLM text, commands, JavaScript, MCP payloads, credentials, prompts, or user-avatar control fields. Add the domain barrel and package export.

- [x] **Step 4: Run the contract test and package typecheck**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/contracts.test.ts` and `pnpm -F @proj-airi/stage-ui typecheck`

Expected: PASS with no TypeScript errors.

### Task 2: Add explicit server profiles and consent grants

**Files:**
- Create: `packages/stage-ui/src/domains/minecraft-companion/server-profile.ts`
- Create: `packages/stage-ui/src/domains/minecraft-companion/schemas.ts`
- Test: `packages/stage-ui/src/domains/minecraft-companion/server-profile.test.ts`

- [x] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from 'vitest'

import { parseMinecraftConsentGrant, parseMinecraftServerProfile } from './index'

describe('Minecraft server profile and consent schemas', () => {
  it('accepts an explicit third-party offline profile', () => {
    const result = parseMinecraftServerProfile({
      contractVersion: 'minecraft-companion/v1',
      serverProfileId: 'pcl-private-1',
      host: '127.0.0.1',
      port: 25565,
      minecraftVersion: '1.21.1',
      runtime: 'fabric',
      authMode: 'offline',
      serverKind: 'third-party',
      accountProfileId: 'airi-bot',
      allowVirtualPlayerJoin: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing explicit auth and account decisions', () => {
    const result = parseMinecraftServerProfile({ contractVersion: 'minecraft-companion/v1', host: 'localhost', port: 25565 })
    expect(result.success).toBe(false)
  })

  it('requires a separate join grant and rejects revoked grants', () => {
    const result = parseMinecraftConsentGrant({
      contractVersion: 'minecraft-agent-control/v1',
      grantId: 'grant-1',
      serverProfileId: 'pcl-private-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['look-at', 'send-chat'],
      grantedAt: 1_000,
      showPersistentIndicator: true,
    })
    expect(result.success).toBe(true)
    expect(parseMinecraftConsentGrant({ ...(result.success ? result.output : {}), revokedAt: 2_000 }).success).toBe(true)
  })
})
```

- [x] **Step 2: Run the tests to verify the schema is missing**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/server-profile.test.ts`

Expected: FAIL because the parsers do not exist.

- [x] **Step 3: Implement strict bounded schemas and profile helpers**

Use Valibot `strictObject`, bounded identifier/host/version strings, integer port range, explicit auth/server-kind enums, and separate `MinecraftConsentGrant`. Validate the profile before a runtime adapter can use it. Expose `parseMinecraftServerProfile` and `parseMinecraftConsentGrant`; never parse PCL files or tokens in this domain.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/server-profile.test.ts` and `pnpm -F @proj-airi/stage-ui typecheck`

Expected: PASS.

### Task 3: Implement action risk policy and goal admission

**Files:**
- Create: `packages/stage-ui/src/domains/minecraft-companion/policy.ts`
- Create: `packages/stage-ui/src/domains/minecraft-companion/goal.ts`
- Test: `packages/stage-ui/src/domains/minecraft-companion/policy.test.ts`

- [x] **Step 1: Write failing policy tests**

```ts
import { describe, expect, it } from 'vitest'

import { assessMinecraftAction, createMinecraftGoal } from './index'

describe('Minecraft companion action policy', () => {
  const context = {
    serverProfileId: 'pcl-private-1',
    consent: {
      grantId: 'grant-1',
      serverProfileId: 'pcl-private-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['look-at', 'follow-player', 'send-chat'],
      grantedAt: 1,
      showPersistentIndicator: true,
    },
    now: 10_000,
  } as const

  it('auto-admits low-risk actions only when the matching grant exists', () => {
    expect(assessMinecraftAction({ kind: 'follow-player', playerId: 'player-1', radius: 4 }, context)).toMatchObject({ riskClass: 'low', decision: 'auto' })
    expect(assessMinecraftAction({ kind: 'jump' }, context)).toMatchObject({ decision: 'reject', errorCode: 'action-not-granted' })
  })

  it('requires approval for high-risk and rejects prohibited actions', () => {
    expect(assessMinecraftAction({ kind: 'attack', targetId: 'zombie-1' }, context)).toMatchObject({ riskClass: 'high', decision: 'approval-required' })
    expect(assessMinecraftAction({ kind: 'execute-command', command: '/op me' }, context)).toMatchObject({ decision: 'reject', errorCode: 'arbitrary-command-forbidden' })
  })

  it('creates bounded goals and rejects free-form action text', () => {
    expect(createMinecraftGoal({ goalId: 'goal-1', sessionId: 'session-1', generation: 1, serverProfileId: 'pcl-private-1', consentGrantId: 'grant-1', kind: 'follow-player', playerId: 'player-1', createdAt: 1_000, expiresAt: 10_000 }).ok).toBe(true)
    expect(createMinecraftGoal({ kind: 'do-anything', prompt: 'run arbitrary command' }).ok).toBe(false)
  })
})
```

- [x] **Step 2: Run the policy tests and confirm RED**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/policy.test.ts`

Expected: FAIL because admission and goal helpers are not implemented.

- [x] **Step 3: Implement deterministic action and goal policy**

Map every action kind to a fixed risk class. Permit the Phase A low-risk allowlist, model medium/high actions as typed proposals only, and reject prohibited kinds with stable codes. Enforce matching server profile, non-revoked consent, allowed action kind, bounded TTL and no text-driven action expansion. `createMinecraftGoal` must return a schema-validated goal or a stable rejection result.

- [x] **Step 4: Run policy tests and typecheck**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/policy.test.ts` and `pnpm -F @proj-airi/stage-ui typecheck`

Expected: PASS.

### Task 4: Add intent lifecycle, generation isolation, TTL and duplicate protection

**Files:**
- Create: `packages/stage-ui/src/domains/minecraft-companion/intent.ts`
- Test: `packages/stage-ui/src/domains/minecraft-companion/intent.test.ts`

- [x] **Step 1: Write failing lifecycle tests**

```ts
import { describe, expect, it } from 'vitest'

import { MinecraftIntentController } from './index'

describe('Minecraft action intent lifecycle', () => {
  it('requires approval before executing a high-risk proposal', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 1, now: () => 1_000 })
    const proposed = controller.propose({ intentId: 'intent-1', goalId: 'goal-1', serverProfileId: 'pcl-private-1', consentGrantId: 'grant-1', action: { kind: 'attack', targetId: 'zombie-1' }, riskClass: 'high', createdAt: 1_000, expiresAt: 5_000 })
    expect(proposed.ok && proposed.value.state).toBe('awaiting-approval')
    expect(controller.startExecution('intent-1').ok).toBe(false)
    expect(controller.approve('intent-1').ok).toBe(true)
    expect(controller.startExecution('intent-1').ok).toBe(true)
  })

  it('rejects duplicate IDs, stale generations and expired intents', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 2, now: () => 10_000 })
    const input = { intentId: 'intent-1', goalId: 'goal-1', serverProfileId: 'profile-1', consentGrantId: 'grant-1', action: { kind: 'jump' } as const, riskClass: 'low' as const, createdAt: 1_000, expiresAt: 9_000 }
    expect(controller.propose(input).ok).toBe(false)
    expect(controller.propose({ ...input, expiresAt: 20_000 }).ok).toBe(true)
    expect(controller.propose({ ...input, expiresAt: 20_000 }).ok).toBe(false)
  })

  it('cancels all queued work and increments generation on stop', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 1, now: () => 1_000 })
    controller.propose({ intentId: 'intent-1', goalId: 'goal-1', serverProfileId: 'profile-1', consentGrantId: 'grant-1', action: { kind: 'jump' }, riskClass: 'low', createdAt: 1_000, expiresAt: 5_000 })
    const stopped = controller.stop('user-stop')
    expect(stopped.generation).toBe(2)
    expect(stopped.intents[0]?.state).toBe('cancelled')
    expect(controller.startExecution('intent-1').ok).toBe(false)
  })
})
```

- [x] **Step 2: Run the lifecycle tests and confirm RED**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/intent.test.ts`

Expected: FAIL because `MinecraftIntentController` does not exist.

- [x] **Step 3: Implement the minimal controller**

Store only bounded structured intents. Check session and generation, `createdAt <= now < expiresAt`, a maximum TTL, and unique intent IDs. Enforce legal transitions: low-risk auto proposals may execute, approval-required proposals must be approved, and terminal intents cannot be restarted. `stop()` cancels non-terminal intents, increments generation, and makes all previous-generation calls stale. Return stable error codes without raw action text.

- [x] **Step 4: Run targeted tests and package typecheck**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/{contracts,server-profile,policy,intent}.test.ts` and `pnpm -F @proj-airi/stage-ui typecheck`

Expected: all Phase A tests PASS and typecheck is clean.

### Task 5: Verify integration surface without runtime wiring

**Files:**
- Modify: `packages/stage-ui/src/domains/minecraft-companion/index.ts`
- Modify: `packages/stage-ui/package.json`
- Test: `packages/stage-ui/src/domains/minecraft-companion/public-api.test.ts`

- [x] **Step 1: Add a public API test**

Import the domain through `@proj-airi/stage-ui/domains/minecraft-companion` and assert the contract constants and controller are available. This protects the later Brain/Fabric adapters from importing private paths.

- [x] **Step 2: Run the API test and relevant checks**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/domains/minecraft-companion/public-api.test.ts`, `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm exec eslint packages/stage-ui/src/domains/minecraft-companion packages/stage-ui/package.json`, and `git diff --check`.

Expected: tests and typecheck pass; lint reports no new errors; no runtime or provider files are changed.

- [x] **Step 3: Record the handoff**

Document that Phase A is domain-only, list the exact exported contracts and stable errors, and explicitly note that Brain/TaskExecutor/Fabric wiring is deferred to Phase B. Do not commit, stage, push, or create a PR unless the user separately requests it.

---

## Execution Handoff

Phase A is implemented as a domain-only boundary. The public export is `@proj-airi/stage-ui/domains/minecraft-companion`, covering:

- `minecraft-companion/v1` observation/profile lane and `minecraft-agent-control/v1` goal/action lane.
- Explicit server profile and consent grant parsers, including PCL-compatible non-official server metadata without launcher credentials.
- Bounded goal/action schemas, deterministic low/medium/high/prohibited risk policy, and stable error codes.
- `MinecraftIntentController` with approval, terminal transitions, TTL, duplicate IDs, stop cancellation and generation isolation.
- `MinecraftAgentExecutorAdapter` interface for the later Mineflayer and Fabric consumers.

Verified with 14 targeted Vitest tests, `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm exec eslint packages/stage-ui/src/domains/minecraft-companion`, and `git diff --check`. Brain/TaskExecutor, Mineflayer transport, Eventa wire handlers and Fabric runtime remain Phase B/C work and are not claimed complete.

---

## Exit Criteria

- Contract and schema tests prove bounded structured goals/actions, explicit PCL-compatible server profiles, separate consent, risk gating, intent lifecycle, TTL, generation isolation, duplicate rejection and stop cancellation.
- `@proj-airi/stage-ui/domains/minecraft-companion` is importable through the package export.
- No raw media, credentials, arbitrary commands, free-form model output or real-player automation fields exist in the Phase A contracts.
- Targeted tests, package typecheck, lint and `git diff --check` pass.
- No executor, provider, Brain, Mineflayer or Fabric runtime behavior is claimed as complete.
