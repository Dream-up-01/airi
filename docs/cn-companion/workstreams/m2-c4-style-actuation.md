# M2-C4 voice style and basic actuation

- Owner: Integration Owner (`/root`)
- Status: automated verification passed; audible provider-matrix acceptance pending.
- Scope: Bounded `VoiceStyleDirective` derivation and minimal `StageActuationIntentLite` production wiring.
- Inputs: M1 risk/scenario policy, trusted active-card speech rate/pitch, explicit user speech controls, voice mode, and declared provider capability.
- Safety: assistant text cannot inject style, SSML, motion IDs, expression IDs, tools, or personality changes. Crisis output cannot become faster or louder. Unsupported capabilities downgrade to neutral/warm and surface an allowlisted development warning.
- TTS: MiniMax receives bounded speed/volume/pitch and an allowlisted `calm|happy` mapping. SSML-capable providers receive code-generated, escaped SSML only.
- Stage: only `listening | thinking | speaking | interrupted | idle` and bounded emotion hints reach the existing Stage primitives.
- Verification: style/actuation/runtime-store/provider tests are included in the 2026-07-14 stage-ui M2 run (`24` files, `136` tests); unsupported style/prosody warnings remain allowlisted and diagnostics-safe. Root typecheck passed and root lint reported `0` warnings/errors.
- Contract version/commit: working tree based on `c5e3f4aea1d3585b6812c1f393188fc0f2851728`; no commit requested.
