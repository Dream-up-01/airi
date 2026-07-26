import { describe, expect, it } from 'vitest'

import { deriveVoiceStyleDirective, voiceStyleCapabilitiesForProvider } from './style'

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
    expect(voiceStyleCapabilitiesForProvider('gpt-sovits-local', 'airi-firefly-v4')).toEqual({
      supportsStyle: false,
      supportsProsody: false,
    })
  })
})
