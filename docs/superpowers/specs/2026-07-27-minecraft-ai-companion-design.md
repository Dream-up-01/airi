# Minecraft AI Companion Design

## Status

Design proposal for the post-M3 Minecraft AI Companion workstream. This document is not an implementation claim. The design keeps M3 trusted perception contracts intact and adds a separate, explicitly authorized action plane.

## Product Scope

AIRI controls an independent AI virtual player that joins the same Minecraft server as the real player. The virtual player can talk, follow, navigate, observe bounded world state, perform approved tasks and react to danger. AIRI never directly controls the user's real player in the first phase.

The Fabric client mod is a player-side companion bridge. It reports bounded local-player and world observations and exposes lifecycle controls. The AI virtual player remains a separate Mineflayer account/runtime managed by `services/minecraft`.

## PCL And Server Assumptions

PCL is treated only as a launcher. It is not treated as an official server, an authentication authority or a source of account credentials.

Supported server profiles must be explicit and user-selected:

- `serverProfileId`: stable local identifier, not a raw address in context or telemetry.
- `host` and `port`: stored in the profile boundary and used only by the selected runtime.
- `minecraftVersion`, loader/runtime and protocol compatibility.
- `authMode`: `online`, `offline`, `custom-provider` or `unknown`.
- `serverKind`: `official`, `private`, `lan`, `third-party`, `proxy` or `unknown`.
- `accountProfileId` for the independent AI player, never an access token.
- `allowVirtualPlayerJoin`: explicit user grant.

PCL may launch Fabric, vanilla, LAN, private, proxy-backed or third-party servers. The product must not assume Mojang session services, Realms, Microsoft authentication or server-side AIRI support. Online and offline/custom authentication are separate configured paths; there is no silent fallback between them. PCL credentials and launcher files never cross the AIRI channel.

If the selected server rejects the independent account, requires a server plugin, or uses an unsupported authentication/protocol path, AIRI degrades to player-side perception and social context. It must report a stable capability error instead of attempting arbitrary server commands or impersonation.

The AIRI loopback WebSocket (`127.0.0.1:6121`) is the local application channel only. It is never used as the Minecraft server endpoint and is never inferred from PCL.

## Architecture

```text
canonical voice/text turn
  -> Minecraft Interaction Router
       -> structured MinecraftGoal
       -> consent and server-profile policy
  -> services/minecraft Brain
       -> deterministic reflex layer
       -> bounded action planner
       -> ActionPolicyGate
  -> Mineflayer virtual-player runtime
       -> selected Minecraft server profile
  -> action result / chat / structured state
       -> AIRI context, TTS and Stage reaction

Fabric client mod
  -> minecraft:companion:v1 observations
       player status | nearby players | crosshair target | chat/social events
  -> AIRI perception manager / interaction router
```

`services/minecraft` remains the decision owner for the virtual player. The Fabric mod does not become a second LLM, transcript source or action planner.

## Wire Contracts

The action plane uses a new capability-owned contract, separate from `minecraft:perception:v1`:

- `minecraft:companion:v1`: bounded player-side observations and social events.
- `minecraft:agent-control:v1`: goal requests, action proposals, approvals, execution results and cancellation.

Every request carries `sessionId`, `generation`, `intentId`, `serverProfileId`, `createdAt`, `expiresAt`, `riskClass` and `consentGrantId`. Old generations, stale server profiles and duplicate intent IDs are rejected.

The Mod receives only allowlisted structured actions. It never receives raw LLM text, character prompts, complete chat history, JavaScript, MCP code, shell commands or arbitrary Minecraft commands.

The first control action enum is:

- `look-at`
- `move-to-player`
- `follow-player`
- `jump`
- `send-chat`
- `select-hotbar`
- `use-held-item`

Mineflayer remains the executor for the independent virtual player. The same domain action schemas are adapted to Mineflayer actions; transport-specific code does not redefine action semantics.

## Action Policy

The policy gate is framework-agnostic and runs before any executor:

| Risk | Examples | Default |
|---|---|---|
| low | look, short move, follow, jump, chat | auto with session grant |
| medium | equip, craft, long navigation, enter unknown area | propose, auto only in explicit play mode |
| high | use held item with unknown effects, attack, break/place, give/drop, trade, dimension change | per-action user approval |
| prohibited | arbitrary command, code execution, user-avatar control, credential action | reject |

The user can stop the virtual player immediately. Stop, revoke, server disconnect, profile switch, privacy mode and `别看了/停止行动` cancel queued proposals and invalidate the current generation.

## Perception And Efficiency

The virtual player uses event-driven updates instead of an LLM call on every Minecraft tick:

- deterministic reflexes handle immediate hazards, low health and recovery;
- structured state snapshots are emitted on meaningful change with a bounded heartbeat;
- Brain turns are triggered by player chat, explicit voice goals, material task changes, danger transitions and action results;
- screen/camera frames are requested only for explicit visual questions or unresolved UI/scene relations;
- raw frames, full OCR, complete external chat and free-form model output never enter persistent state or prompt context.

Player names, chat text, server messages and visual text remain untrusted content. They may inform a goal or social response but cannot expand permissions or become system instructions.

## Voice, Chat And Stage Integration

The existing canonical transcript is the only voice input. A router classifies a user turn into ordinary conversation or a bounded `MinecraftGoal`; it does not create a second transcription path.

The virtual player can respond through:

- existing AIRI assistant text and TTS;
- bounded Minecraft chat messages;
- Stage reaction candidates derived from accepted action results or salient state changes.

The virtual player never generates TTS directly from the Mod or from an unvalidated model response. Existing safety, relationship and persona policies remain authoritative.

## Lifecycle And Failure Handling

1. User selects and validates a server profile.
2. User grants virtual-player join and selected action categories.
3. Mineflayer connects using the selected auth/runtime path.
4. The Mod and virtual player identify the same approved server profile through a non-secret server fingerprint.
5. AIRI publishes bounded state and starts Brain/reflex processing.
6. Stop/revoke/disconnect increments generation, cancels actions and retracts projections.

Failure cases have stable codes: `server-profile-invalid`, `server-auth-required`, `server-auth-failed`, `server-version-unsupported`, `virtual-player-rejected`, `server-plugin-required`, `control-denied`, `action-expired`, `action-cancelled`, `server-untrusted` and `virtual-player-conflict`.

There is no silent auth fallback, server switching, account switching or autonomous retry loop that can create cost or duplicate players.

## Implementation Phases

### Phase A: Domain And Contracts

- Define `MinecraftGoal`, `MinecraftAgentAction`, risk classes, grants, server profiles, intent lifecycle and stable errors.
- Add schemas and fake-clock/generation tests.
- Add an adapter interface so Mineflayer and future providers share action semantics.

### Phase B: AIRI Virtual Player Runtime

- Wrap the existing Brain/TaskExecutor around the adapter interface.
- Add goal routing from canonical voice/text turns.
- Add action proposals, approval, cancellation and result projection.
- Keep existing Mineflayer actions and reflexes as the first executor.

### Phase C: Fabric Companion Bridge

- Add `minecraft:companion:v1` player-side observation events.
- Add server-profile handshake and non-secret fingerprint binding.
- Add HUD/status visibility for virtual-player connection, current goal, action proposal and stop state.
- Do not add real-player automation in this phase.

### Phase D: Voice And Immersion

- Connect goal/result events to existing TTS and Stage reaction policy.
- Add bounded in-game chat synchronization.
- Add user-facing controls for play mode, action approvals, quiet mode and emergency stop.

### Phase E: Real Server Acceptance

- PCL-launched Fabric client plus a separate virtual-player account on a private/LAN/third-party server.
- Online, offline/custom authentication profiles tested independently.
- Verify chat, follow, navigation, stop, danger reflex, action denial, reconnect, restart and profile mismatch.

## Acceptance Criteria

- The virtual player joins the same non-official server without relying on PCL credentials.
- Voice command causes a bounded goal, not a free-form action.
- Low-risk interaction works end to end: approach, look, follow and chat.
- High-risk actions require the configured approval path and are cancellable.
- Disconnect, revoke and profile mismatch stop actions and retract current context.
- No raw media, credentials, arbitrary commands or free model output crosses the action contract.
- Existing M1 safety/persona rules and M3 perception guarantees remain intact.

## Open Decision For Implementation

The first implementation should target one concrete non-official server profile and one authentication mode selected by the user. The protocol must support the other modes, but it must not pretend to support them before a real provider test exists.
