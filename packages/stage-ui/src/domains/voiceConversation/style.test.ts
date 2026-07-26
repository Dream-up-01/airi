import { describe, expect, it } from 'vitest'

import { applyVoiceStyleToProviderConfig, deriveVoiceStyleDirective, hasNumericProsody, voiceStyleCapabilitiesForProvider } from './style'

describe('voice style directive derivation', () => {
  it('uses calm bounded delivery for crisis support and rejects playful preference', () => {
    const result = deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
      preferredStyle: 'playful',
    })

    expect(result.directive).toEqual({
      style: 'comforting',
      pace: 'slow',
      energy: 'low',
      rate: 0.92,
      volume: 0.92,
    })
    expect(result.warnings.map(warning => warning.code)).toContain('voice-style.unsafe-preferred-style')
  })

  it('allows playful delivery only for ordinary casual turns', () => {
    const result = deriveVoiceStyleDirective({
      policy: { risk: 'none', scenario: 'casual' },
      preferredStyle: 'playful',
    })

    expect(result.directive).toMatchObject({
      style: 'playful',
      pace: 'normal',
      energy: 'high',
    })
    expect(result.warnings).toEqual([])
  })

  it('maps companion scenarios to stable default styles', () => {
    expect(deriveVoiceStyleDirective({ policy: { risk: 'none', scenario: 'venting' } }).directive).toMatchObject({
      style: 'comforting',
      pace: 'slow',
      energy: 'low',
    })
    expect(deriveVoiceStyleDirective({ policy: { risk: 'none', scenario: 'study' } }).directive).toMatchObject({
      style: 'serious',
      pace: 'normal',
      energy: 'normal',
    })
    expect(deriveVoiceStyleDirective({ policy: { risk: 'none', scenario: 'advice' } }).directive).toMatchObject({
      style: 'warm',
    })
  })

  it('degrades emotional style and prosody when provider capabilities do not support them', () => {
    const result = deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
      providerCapabilities: {
        supportsStyle: false,
        supportsProsody: false,
      },
    })

    expect(result.directive).toEqual({
      style: 'warm',
      pace: 'slow',
      energy: 'low',
    })
    expect(result.warnings.map(warning => warning.code)).toEqual([
      'voice-style.unsupported-style',
      'voice-style.unsupported-prosody',
    ])
  })

  it('clamps numeric prosody to provider capability bounds', () => {
    const result = deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
      providerCapabilities: {
        supportsStyle: true,
        supportsProsody: true,
        rate: { min: 0.95, max: 1.1 },
        volume: { min: 0.96, max: 1.0 },
      },
    })

    expect(result.directive.rate).toBe(0.95)
    expect(result.directive.volume).toBe(0.96)
    expect(result.warnings.map(warning => warning.code)).toEqual([
      'voice-style.clamped-rate',
      'voice-style.clamped-volume',
    ])
  })

  it('combines trusted card/user prosody while keeping crisis delivery conservative', () => {
    const result = deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
      speechBinding: { rate: 1.4, pitchShift: 30, volume: 1.4 },
      userPreferences: { rate: 1.2, pitchShift: 20, volume: 1.2 },
      providerCapabilities: voiceStyleCapabilitiesForProvider('minimax-speech', 'speech-2.8-turbo'),
    })

    expect(result.directive).toMatchObject({
      style: 'comforting',
      rate: 1,
      pitchShift: 12,
      volume: 1,
    })
    expect(result.warnings.map(warning => warning.code)).toContain('voice-style.clamped-pitch')
  })

  it('uses explicit push-to-talk mode as a neutral casual default', () => {
    expect(deriveVoiceStyleDirective({
      policy: { risk: 'none', scenario: 'casual' },
      mode: 'push-to-talk',
    }).directive.style).toBe('neutral')
  })

  it('declares only implemented provider style capabilities', () => {
    expect(voiceStyleCapabilitiesForProvider('minimax-speech', 'speech-2.8-turbo')).toMatchObject({
      supportsStyle: true,
      supportsProsody: true,
    })
    expect(voiceStyleCapabilitiesForProvider('unknown-speech-provider', 'some-model')).toEqual({
      supportsStyle: false,
      supportsProsody: false,
    })
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // `voiceStyleCapabilitiesForProvider` had no entry for `gpt-sovits-local`,
  // so it fell through to the `supportsProsody: false` baseline and
  // `deriveVoiceStyleDirective` stripped every numeric prosody hint — the
  // local bridge then synthesized crisis support at the configured speed even
  // though its API accepts a bounded `speed` parameter
  // (`services/tts/gpt-sovits-airi/server.py:47`, mapped to `speed_factor`
  // at `server.py:183`).
  //
  // We fixed this by declaring a capability entry with the bridge's real
  // rate bounds (0.5..2.0) and no bounds for the dimensions it cannot honor.
  it('declares the local GPT-SoVITS bridge speed capability with its real bounds', () => {
    expect(voiceStyleCapabilitiesForProvider('gpt-sovits-local', 'airi-firefly-v4')).toEqual({
      supportsStyle: false,
      supportsProsody: true,
      rate: { min: 0.5, max: 2 },
    })
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // `clampOptional` passed values through unchanged when a capability entry
  // declared no bounds for a dimension. With partial-bounds entries (the
  // GPT-SoVITS bridge only accepts `speed`), the crisis `volume: 0.92` hint
  // would have leaked unclamped into the provider config for a parameter the
  // provider does not even accept.
  //
  // We fixed this by stripping dimensions without declared bounds (fail
  // closed) and surfacing the existing unsupported-prosody warning.
  it('keeps the crisis slow-rate hint for GPT-SoVITS and strips unbounded dimensions', () => {
    const result = deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
      providerCapabilities: voiceStyleCapabilitiesForProvider('gpt-sovits-local', 'airi-firefly-v4'),
    })

    // `supportsStyle: false` degrades crisis 'comforting' to 'warm' (the
    // established crisis-safe degradation), while the numeric slow-rate
    // hint must survive because the bridge accepts `speed`.
    expect(result.directive.style).toBe('warm')
    expect(result.directive.rate).toBe(0.92)
    expect(result.directive.pitchShift).toBeUndefined()
    expect(result.directive.volume).toBeUndefined()
    expect(result.warnings.map(warning => warning.code)).toContain('voice-style.unsupported-prosody')
  })
})

describe('applyVoiceStyleToProviderConfig', () => {
  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // The previous Stage.vue-private helper spread `speed` / `pitch` /
  // `volume` unconditionally:
  //
  //   return { ...providerConfig, speed: directive.rate, pitch: directive.pitchShift, ... }
  //
  // A directive that omitted a dimension (crisis directives set no
  // pitchShift; partial-bounds providers strip dimensions) therefore
  // overwrote user-configured provider values with `undefined`.
  //
  // We fixed this by moving the helper into the voiceConversation style
  // domain and writing only the keys the directive actually sets, keeping
  // the original provider config values otherwise.
  it('keeps provider config values for dimensions the directive does not set', () => {
    const providerConfig = { speed: 1.3, pitch: 4, volume: 0.8, extra: 'keep' }

    const next = applyVoiceStyleToProviderConfig(providerConfig, {
      style: 'comforting',
      pace: 'slow',
      energy: 'low',
      rate: 0.92,
    }, false)

    expect(next.speed).toBe(0.92)
    expect(next.pitch).toBe(4)
    expect(next.volume).toBe(0.8)
    expect(next.voiceStyle).toBe('comforting')
    expect(next.extra).toBe('keep')
  })

  it('overrides every dimension the directive sets', () => {
    const next = applyVoiceStyleToProviderConfig({ speed: 1.5, pitch: 9, volume: 1.4 }, {
      style: 'comforting',
      rate: 0.92,
      pitchShift: -2,
      volume: 0.92,
    }, false)

    expect(next.speed).toBe(0.92)
    expect(next.pitch).toBe(-2)
    expect(next.volume).toBe(0.92)
  })

  it('maps volume to an SSML percent offset only when the directive sets volume', () => {
    const withVolume = applyVoiceStyleToProviderConfig({}, {
      style: 'comforting',
      volume: 0.92,
    }, true)
    expect(withVolume.volume).toBeCloseTo(-8)

    const withoutVolume = applyVoiceStyleToProviderConfig({ volume: 0.7 }, {
      style: 'comforting',
    }, true)
    expect(withoutVolume.volume).toBe(0.7)
  })

  it('returns the provider config unchanged when there is no directive', () => {
    const providerConfig = { speed: 1.1 }
    expect(applyVoiceStyleToProviderConfig(providerConfig, undefined, false)).toBe(providerConfig)
  })
})

describe('hasNumericProsody', () => {
  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  //
  // Stage.vue forced SSML for every voice-session segment that resolved a
  // style at all:
  //
  //   forceSSML: supportsSSML && (ssmlEnabled.value || !!voiceStyleResolution)
  //
  // `ssmlEnabled` defaults to false
  // (`packages/stage-ui/src/stores/modules/speech.ts`), so a user who
  // deliberately keeps SSML off still got SSML input for every segment of a
  // voice session with a companion card. For the study / advice / relationship
  // scenarios `baseDirectiveForPolicy` sets no rate/pitchShift/volume, and with
  // the global speech rate at 1 and pitch at 0 no user preference fills them in
  // either — `generateSSML`'s `hasProsody` was then false and the generated
  // markup wrapped the text in a bare `<speak><voice>`: zero delivery benefit,
  // while overriding the user's setting and taking the provider off its
  // plain-text path.
  //
  // We fixed this by forcing SSML only when the directive actually carries
  // numeric prosody, the one part of a directive an SSML provider cannot
  // receive through the provider config.
  it('reports no numeric prosody for style-only scenario directives', () => {
    for (const scenario of ['study', 'advice', 'relationship'] as const) {
      const { directive } = deriveVoiceStyleDirective({ policy: { risk: 'none', scenario } })

      expect(directive.rate).toBeUndefined()
      expect(directive.pitchShift).toBeUndefined()
      expect(directive.volume).toBeUndefined()
      expect(hasNumericProsody(directive)).toBe(false)
    }
  })

  // The SSML a style-only directive would have produced carries nothing:
  // `generateSSML` reads exactly these three provider config keys
  // (`packages/stage-ui/src/stores/modules/speech.ts`) to decide whether to
  // emit a `<prosody>` element.
  it('agrees with the provider config a style-only directive produces', () => {
    const { directive } = deriveVoiceStyleDirective({ policy: { risk: 'none', scenario: 'study' } })
    const providerConfig = applyVoiceStyleToProviderConfig({}, directive, true)

    expect(providerConfig.speed).toBeUndefined()
    expect(providerConfig.pitch).toBeUndefined()
    expect(providerConfig.volume).toBeUndefined()
    expect(providerConfig.voiceStyle).toBe('serious')
    expect(hasNumericProsody(directive)).toBe(false)
  })

  it('reports numeric prosody for directives that clamp delivery', () => {
    expect(hasNumericProsody(deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
    }).directive)).toBe(true)

    expect(hasNumericProsody(deriveVoiceStyleDirective({
      policy: { risk: 'none', scenario: 'venting' },
    }).directive)).toBe(true)
  })

  it('reports numeric prosody once a user preference fills a dimension in', () => {
    const { directive } = deriveVoiceStyleDirective({
      policy: { risk: 'none', scenario: 'study' },
      userPreferences: { rate: 1.15 },
    })

    expect(directive.rate).toBe(1.15)
    expect(hasNumericProsody(directive)).toBe(true)
  })

  it('reports no numeric prosody once a provider without prosody support strips it', () => {
    const { directive } = deriveVoiceStyleDirective({
      policy: { risk: 'crisis', scenario: 'crisis' },
      providerCapabilities: voiceStyleCapabilitiesForProvider('unknown-speech-provider', 'some-model'),
    })

    expect(hasNumericProsody(directive)).toBe(false)
  })

  it('treats an unresolved directive and non-finite values as no prosody', () => {
    expect(hasNumericProsody(undefined)).toBe(false)
    expect(hasNumericProsody({ style: 'neutral' })).toBe(false)
    expect(hasNumericProsody({ style: 'neutral', rate: Number.NaN })).toBe(false)
    expect(hasNumericProsody({ style: 'neutral', volume: Number.POSITIVE_INFINITY })).toBe(false)
    expect(hasNumericProsody({ style: 'neutral', pitchShift: 0 })).toBe(true)
  })
})
