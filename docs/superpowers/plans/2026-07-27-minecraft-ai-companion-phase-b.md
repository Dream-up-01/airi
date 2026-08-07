# Minecraft AI Companion Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the reviewed Phase A action contracts to AIRI's Minecraft service so approved structured goals can reach the existing Mineflayer TaskExecutor without allowing free-form commands or bypassing consent.

**Architecture:** The service receives a canonical `spark:command`, extracts only a strict allowlisted Minecraft goal phrase, and passes a structured action plus an explicit policy context to the Phase A `MinecraftIntentController`. A runtime adapter maps approved low-risk actions to existing TaskExecutor/Mineflayer operations and reports bounded results. Unrecognized action text, unauthorized actions, and high-risk actions fail closed and never enter the legacy Brain execution path.

**Tech Stack:** TypeScript, Vitest, existing `services/minecraft` EventBus/AiriBridge/Brain/TaskExecutor, `@proj-airi/stage-ui/domains/minecraft-companion` contracts, Mineflayer.

**Reviewed implementation status (2026-07-28):** The bounded low-risk production path is implemented behind the default-off `MINECRAFT_AGENT_CONTROL_ENABLED=true` process-session opt-in. Canonical Spark wire validation, bounded replay protection, fail-closed fallback, force-interrupt cancellation, and awaited shutdown are covered by tests. High-risk approval remains fail-closed because the current Server SDK does not expose a verified user authority suitable for enable/approve/revoke; PCL/offline usernames and Spark payload text are explicitly not accepted as authority.

---

## Tasks

### Task 1: Keep Phase A admission mandatory at the service boundary

**Files:**
- Modify: `packages/stage-ui/src/domains/minecraft-companion/contracts.ts`
- Modify: `packages/stage-ui/src/domains/minecraft-companion/intent.ts`
- Modify: `packages/stage-ui/src/domains/minecraft-companion/schemas.ts`
- Test: `packages/stage-ui/src/domains/minecraft-companion/intent.test.ts`
- Test: `packages/stage-ui/src/domains/minecraft-companion/contracts.test.ts`

- [x] **Step 1: Add failing consent and risk-mismatch tests**

The tests must pass an explicit policy context to `MinecraftIntentController.propose()` and assert that a revoked/non-joining grant returns `consent-required`, while a `jump` proposal with `riskClass: high` fails schema validation.

- [x] **Step 2: Implement mandatory policy admission**

Require `MinecraftActionPolicyContext` in `propose()`, match `serverProfileId` and `consent.grantId`, call `assessMinecraftAction()`, and choose `approved` only for `decision: auto`; use `awaiting-approval` for approval-required actions. Reject mismatched proposal risk and action fields in the strict schema.

- [x] **Step 3: Run Phase A regression tests**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/domains/minecraft-companion` and `pnpm -F @proj-airi/stage-ui typecheck`

Expected: 16 tests pass and package typecheck is clean.

### Task 2: Add a strict Spark-to-goal router

**Files:**
- Create: `services/minecraft/src/cognitive/companion/goal-router.ts`
- Test: `services/minecraft/src/cognitive/companion/goal-router.test.ts`

- [x] **Step 1: Write failing parser tests**

```ts
it('parses only bounded follow, move, look, jump and chat phrases', () => {
  expect(parseMinecraftCommand('follow player Alex at 4')).toEqual({ kind: 'follow-player', playerId: 'Alex', radius: 4 })
  expect(parseMinecraftCommand('jump')).toEqual({ kind: 'jump' })
  expect(parseMinecraftCommand('execute command /op me')).toBeUndefined()
  expect(parseMinecraftCommand('follow player Alex; run JavaScript')).toBeUndefined()
})
```

- [x] **Step 2: Run the parser test and verify RED**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion/goal-router.test.ts`

Expected: FAIL because the router module does not exist.

- [x] **Step 3: Implement deterministic parsing**

Accept only case-insensitive patterns for `follow player <identifier> [at <0.5..64>]`, `move to player <identifier> [within <0.5..64>]`, `look at player <identifier>`, `jump`, and `chat <bounded text>`. Reject control characters, slash-prefixed commands, code-like punctuation, unknown verbs, oversized player IDs/messages, and extra trailing text. Never return raw model text as an action.

- [x] **Step 4: Run parser tests and service typecheck**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion/goal-router.test.ts` and `pnpm -F @proj-airi/minecraft-bot typecheck`

Expected: PASS.

### Task 3: Build the service runtime coordinator

**Files:**
- Create: `services/minecraft/src/cognitive/companion/minecraft-agent-runtime.ts`
- Create: `services/minecraft/src/cognitive/companion/minecraft-agent-runtime.test.ts`
- Modify: `services/minecraft/package.json` (add existing workspace package `@proj-airi/stage-ui`)

- [x] **Step 1: Write failing coordinator tests**

```ts
it('does not execute without a join/action grant', async () => {
  const runtime = createRuntimeWithFakeExecutor()
  const result = await runtime.handleAction({ kind: 'jump' }, { commandId: 'cmd-1' })
  expect(result).toMatchObject({ ok: false, errorCode: 'consent-required' })
  expect(executor.execute).not.toHaveBeenCalled()
})

it('executes auto-approved actions and requires approval for high risk', async () => {
  const runtime = createRuntimeWithGrantedActions(['jump', 'attack'])
  expect((await runtime.handleAction({ kind: 'jump' }, { commandId: 'cmd-1' })).state).toBe('completed')
  expect((await runtime.handleAction({ kind: 'attack', targetId: 'zombie-1' }, { commandId: 'cmd-2' })).state).toBe('awaiting-approval')
})
```

- [x] **Step 2: Run coordinator tests and verify RED**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion/minecraft-agent-runtime.test.ts`

Expected: FAIL because the coordinator module does not exist.

- [x] **Step 3: Implement the coordinator around Phase A**

Construct a stable server profile from the selected runtime config, keep consent absent by default, create one controller per bot session, generate bounded IDs/TTL, call `controller.propose(input, policyContext)`, and execute only `approved` intents. Keep `awaiting-approval` intents in memory and expose `approve(intentId)`, `cancel(intentId)`, `stop()`, and `advanceGeneration()` methods. Map executor failures to stable codes and never persist command text or credentials.

- [x] **Step 4: Run coordinator tests and typecheck**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion/minecraft-agent-runtime.test.ts` and `pnpm -F @proj-airi/minecraft-bot typecheck`

Expected: PASS.

### Task 4: Add the bounded Mineflayer executor adapter

**Files:**
- Create: `services/minecraft/src/cognitive/companion/mineflayer-action-executor.ts`
- Create: `services/minecraft/src/cognitive/companion/mineflayer-action-executor.test.ts`

- [x] **Step 1: Write failing adapter tests**

Test that `move-to-player` maps to existing `goToPlayer`, `follow-player` maps to `followPlayer`, `send-chat` maps to `chat` with `feedback: false`, and `jump` uses bounded control-state cleanup. Test that unsupported/high-risk actions return a stable unsupported result and that `cancel()` calls `Mineflayer.interrupt()`.

- [x] **Step 2: Run adapter tests and verify RED**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion/mineflayer-action-executor.test.ts`

Expected: FAIL because the adapter module does not exist.

- [x] **Step 3: Implement the narrow action mapping**

Use existing `TaskExecutor.executeActionWithResult()` for `goToPlayer`, `followPlayer`, and `chat`; use the wrapped Mineflayer bot only for `lookAt`, `jump`, `setQuickBarSlot`, and the future approval-gated `activateItem` adapter. Treat `use-held-item` as high-risk because the equipped item may have destructive effects; it must not enter the process-session automatic grant. Reject all high-risk actions from production input in this phase, clear control state in `finally`, and never invoke ActionRegistry by arbitrary tool name from external text.

- [x] **Step 4: Run adapter tests and typecheck**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion/mineflayer-action-executor.test.ts` and `pnpm -F @proj-airi/minecraft-bot typecheck`

Expected: PASS.

### Task 5: Wire Spark command lifecycle into CognitiveEngine

**Files:**
- Modify: `services/minecraft/src/airi/airi-bridge.ts`
- Modify: `services/minecraft/src/cognitive/index.ts`
- Modify: `services/minecraft/src/cognitive/container.ts`
- Create: `services/minecraft/src/cognitive/companion/index.ts`
- Test: `services/minecraft/src/airi/airi-bridge.test.ts`
- Test: `services/minecraft/src/cognitive/companion/integration.test.ts`

- [x] **Step 1: Write failing bridge/integration tests**

Assert that `AiriBridge` exposes a Spark command listener, recognized structured Minecraft phrases are consumed by the runtime, unrecognized action text fails closed without reaching the existing `airi_command` Brain path, and `beforeCleanup()` awaits runtime cancellation before destroying the executor.

- [x] **Step 2: Run integration tests and verify RED**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/airi/airi-bridge.test.ts src/cognitive/companion/integration.test.ts`

Expected: FAIL because the listener and runtime registration do not exist.

- [x] **Step 3: Implement lifecycle wiring**

Add a typed `onSparkCommand()` listener set to `AiriBridge`; call listeners before the generic Brain routing and let them return `true` only when they consumed a strict Minecraft goal. Register the runtime in the Awilix container, initialize it after TaskExecutor/Mineflayer are ready, and stop it before bridge/brain cleanup. Emit only bounded `spark:emit` states and stable error notes.

- [x] **Step 4: Run service tests, typecheck and lint**

Run: `pnpm -F @proj-airi/minecraft-bot exec vitest run src/cognitive/companion src/airi/airi-bridge.test.ts`, `pnpm -F @proj-airi/minecraft-bot typecheck`, and `pnpm -F @proj-airi/minecraft-bot lint`

Expected: PASS; no Fabric Mod or server-auth behavior is changed.

---

## Exit Criteria

- No structured goal can execute without matching server profile, active consent grant, generation and action allowlist.
- Only strict allowlisted phrases become actions; arbitrary commands, code, MCP, shell, model prompts and user-avatar controls remain rejected.
- Low-risk actions execute through existing TaskExecutor/Mineflayer only after the default-off process-session opt-in; high-risk actions remain non-executable from production input until a verified approval authority exists.
- Unrecognized Spark action commands fail closed and never reach Brain/ActionRegistry execution.
- Replayed command IDs are bounded by capacity/TTL, identical replays are dropped, and changed payloads under the same ID are rejected.
- Force interrupt, stop, cleanup, disconnect and generation changes await cancellation before accepting or destroying subsequent work.
- Service targeted tests, typecheck and lint pass. Full Minecraft server/Fabric acceptance remains Phase E work.
