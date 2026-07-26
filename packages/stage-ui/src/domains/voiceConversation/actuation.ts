import type { StageActuationIntentLite, VoiceConversationSession, VoiceStyleDirective } from './session'

export function deriveStageActuationIntentLite(
  session: VoiceConversationSession | null | undefined,
  style?: VoiceStyleDirective,
): StageActuationIntentLite {
  if (!session) {
    return { state: 'idle', emotion: 'neutral' }
  }

  const correlation = {
    sessionId: session.sessionId,
    turnId: session.activeTurnId,
  }

  switch (session.state) {
    case 'requesting-permission':
    case 'listening':
    case 'speech-detected':
    case 'transcribing':
    case 'user-turn-ready':
      return { state: 'listening', emotion: 'focused', ...correlation }
    case 'thinking':
      return { state: 'thinking', emotion: styleToEmotion(style, 'focused'), ...correlation }
    case 'speaking':
      return { state: 'speaking', emotion: styleToEmotion(style, 'neutral'), ...correlation }
    case 'interrupted':
      return { state: 'interrupted', emotion: 'concerned', ...correlation }
    case 'idle':
    case 'failed':
    case 'stopped':
      return { state: 'idle', emotion: 'neutral', ...correlation }
  }
}

function styleToEmotion(
  style: VoiceStyleDirective | undefined,
  fallback: NonNullable<StageActuationIntentLite['emotion']>,
): NonNullable<StageActuationIntentLite['emotion']> {
  switch (style?.style) {
    case 'cheerful':
    case 'playful':
      return 'happy'
    case 'serious':
      return 'focused'
    case 'comforting':
      return 'comforting'
    case 'warm':
      return 'neutral'
    case 'neutral':
      return 'neutral'
    default:
      return fallback
  }
}
