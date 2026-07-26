# M3.10 Fabric Security And Lifecycle Hardening Implementation Plan

> **For agentic workers:** Execute this plan inline and preserve the existing dirty worktree. Do not create commits, push, or open a PR unless the user explicitly requests it.

**Goal:** Close the remaining local security and lifecycle gaps between AIRI's Minecraft perception adapter and the read-only Fabric Mod before real PCL acceptance.

**Architecture:** Keep pairing authentication in `packages/server-runtime`, device persistence and revocation signaling in the Desktop channel service, and perception provider selection in the Stage UI store. Keep the Mod client-only and read-only; give each process a random module instance identity while retaining the paired device key across processes.

**Tech Stack:** TypeScript, Vitest, Eventa Electron invoke contracts, Vue/Pinia, Java 21, JDK WebSocket/Ed25519/NIO ACL, Fabric 1.21.1, JUnit 5, Gradle.

---

### Task 1: Bind pairing proofs to protocol and process identity

**Files:**
- Modify: `packages/plugin-protocol/src/types/events.ts`
- Modify: `packages/server-runtime/src/index.ts`
- Test: `packages/server-runtime/src/setupApp.liveness.test.ts`
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/transport/DevicePairingKey.java`
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/transport/AiriProtocolCodec.java`
- Test: `C:/Users/wyb/Desktop/airi_mc_connect/src/test/java/moe/airi/mcconnect/transport/AiriProtocolCodecTest.java`

- [ ] Add failing TypeScript and Java tests requiring `protocolVersion` and `moduleInstanceId` in the signed payload.
- [ ] Run the focused tests and confirm signature verification fails with a changed protocol or instance ID.
- [ ] Extend the shared wire types and both proof encoders/verifiers with the exact payload `airi-module-pairing-v1\n1\n<moduleInstanceId>\n<requestId>\n<deviceId>\n<nonce>`.
- [ ] Re-run both focused suites and confirm valid proofs pass while mismatched identities fail.

### Task 2: Create one random module instance ID per Mod process

**Files:**
- Create: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/session/ModuleInstanceId.java`
- Test: `C:/Users/wyb/Desktop/airi_mc_connect/src/test/java/moe/airi/mcconnect/session/ModuleInstanceIdTest.java`
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/AiriMcConnectController.java`
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/transport/AiriWebSocketClient.java`

- [ ] Add a failing test that two process identities differ and both use a bounded `fabric-<uuid>` form.
- [ ] Implement `ModuleInstanceId.create()` with `UUID.randomUUID()`.
- [ ] Create the ID once in `AiriMcConnectController` and pass it through every reconnect.
- [ ] Remove all derivation of module instance ID from persistent `deviceId`.
- [ ] Run the session and transport tests.

### Task 3: Make terminal transport failures non-retriable

**Files:**
- Create: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/transport/ReconnectPolicy.java`
- Test: `C:/Users/wyb/Desktop/airi_mc_connect/src/test/java/moe/airi/mcconnect/transport/ReconnectPolicyTest.java`
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/AiriMcConnectController.java`

- [ ] Add failing table tests classifying pairing denial/expiry/proof, authentication, protocol, announce, consent, and provider-conflict errors as terminal.
- [ ] Add failing cases classifying unreachable/network stop as bounded-retry failures.
- [ ] Implement the allowlisted retry policy and make terminal failures enter `FAILED` immediately.
- [ ] Run all Mod tests and confirm scheduled reconnects remain bounded for retryable failures.

### Task 4: Close authenticated sockets when a device is revoked

**Files:**
- Modify: `packages/server-runtime/src/index.ts`
- Modify: `packages/server-runtime/src/types/conn.ts`
- Test: `packages/server-runtime/src/setupApp.liveness.test.ts`
- Modify: `apps/stage-tamagotchi/src/main/services/airi/channel-server/minecraft-pairing.ts`
- Test: `apps/stage-tamagotchi/src/main/services/airi/channel-server/minecraft-pairing.test.ts`

- [ ] Add a failing runtime test that authenticates and announces a paired Fabric peer, emits device revocation, and expects socket close plus `extension:module:de-announced`.
- [ ] Add a failing manager test proving revocation listeners run only after a persisted paired device is removed.
- [ ] Add an optional revocation subscription to `ModulePairingProvider`, tag paired peers with `deviceId`, and remove matching peers with reason `pairing-revoked`.
- [ ] Ensure runtime disposal unsubscribes the listener and pending approvals are still cancelled.
- [ ] Run server-runtime and Desktop channel pairing tests.

### Task 5: Fail closed on competing Minecraft providers

**Files:**
- Modify: `packages/stage-ui/src/stores/modules/gaming-minecraft.ts`
- Test: `packages/stage-ui/src/stores/modules/gaming-minecraft.test.ts`

- [ ] Add a failing store test with simultaneous Fabric and Mineflayer `minecraft-bot` registry entries.
- [ ] Require exactly one valid provider identity before binding an adapter.
- [ ] On conflict, revoke current facts, advance generation, expose `minecraft-provider-conflict`, and do not accept either provider's events.
- [ ] Confirm removal of the conflict allows the sole authenticated provider to bind deterministically.
- [ ] Run the focused Stage UI tests.

### Task 6: Tighten Windows key ACL and refresh acceptance evidence

**Files:**
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/src/main/java/moe/airi/mcconnect/transport/DevicePairingKey.java`
- Create: `C:/Users/wyb/Desktop/airi_mc_connect/src/test/java/moe/airi/mcconnect/transport/DevicePairingKeyTest.java`
- Modify: `C:/Users/wyb/Desktop/airi_mc_connect/docs/acceptance.md`
- Modify: `docs/cn-companion/workstreams/m3-10-minecraft-perception.md`

- [ ] Add a Windows-conditional failing test that reads the created credential ACL and rejects non-owner allow entries.
- [ ] Use Java NIO `AclFileAttributeView` to replace the credential ACL with one owner-only allow entry; retain POSIX `0600` behavior.
- [ ] Run `gradlew.bat clean check build` and record the actual test count and remapped jar SHA-256.
- [ ] Run focused AIRI Vitest suites, package typechecks, root `pnpm typecheck`, root `pnpm lint`, and `git diff --check`.
- [ ] Update acceptance documents with dated commands, results, and the still-pending real PCL gate.

