import type { MinecraftAgentAction, MinecraftStableErrorCode } from '@proj-airi/stage-ui/domains/minecraft-companion'

const DEFAULT_MOVE_RADIUS = 3
const DEFAULT_FOLLOW_RADIUS = 4
const MAX_PLAYER_ID_LENGTH = 16
const MAX_CHAT_MESSAGE_LENGTH = 256
const MAX_SPARK_COMMAND_LENGTH = 512

const playerIdPattern = String.raw`\w{1,${MAX_PLAYER_ID_LENGTH}}`
const radiusPattern = String.raw`\d+(?:\.\d+)?`

const followPattern = new RegExp(
  String.raw`^follow player (${playerIdPattern})(?: at (${radiusPattern}))?$`,
  'i',
)
const movePattern = new RegExp(
  String.raw`^move to player (${playerIdPattern})(?: within (${radiusPattern}))?$`,
  'i',
)
const lookPattern = new RegExp(String.raw`^look at player (${playerIdPattern})$`, 'i')
const chatPattern = /^chat (.{1,256})$/i
const reservedCommandPrefixPattern = /^(?:follow|move|look|jump|chat)\b/i
const dangerousCommandPattern = /\b(?:javascript|powershell|shell|terminal|botcall)\b|\b(?:execute|run)\s+(?:a\s+)?(?:command|code|script)\b|\b(?:use|call)\s+(?:an?\s+)?(?:mcp\s+)?tool\b|\bmcp(?:\s+tool)?\b|\b(?:api[ _-]?key|access[ _-]?token|credential|password|secret)\b|\b(?:ignore\s+(?:all\s+)?previous|system\s+prompt|developer\s+message)\b|(?:^|\s)\/[a-z]|(?:执行|运行).*(?:代码|命令|脚本|javascript)|终端|命令行|powershell|mcp|工具调用|系统提示词|忽略之前|api[ _-]?key|密钥|口令|令牌|凭据|[;[\]{}()`\\]/i
const userAvatarBoundaryPattern = /\b(?:pcl|keyboard|mouse|keybind)\b|真实玩家|玩家角色|我的角色|我的人物|我的客户端|键盘|鼠标|按键|启动器/i
const userAvatarActionPattern = /\b(?:control|move|press|send)\b/i
const userAvatarSubjectPattern = /\b(?:my|real|user)\s+(?:player|avatar|character)\b/i

export type MinecraftCommandRoute
  = | { kind: 'action', action: MinecraftAgentAction }
    | { kind: 'blocked', errorCode: Extract<MinecraftStableErrorCode, 'arbitrary-command-forbidden' | 'invalid-contract' | 'user-avatar-control-forbidden'> }
    | { kind: 'fallback' }
const safeChatMessagePattern = /^[\p{L}\p{M}\p{N} _.,!?'"@#:，。！？、：…-]+$/u

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (
      code <= 0x1F
      || code === 0x7F
      || (code >= 0x80 && code <= 0x9F)
      || code === 0x2028
      || code === 0x2029
    ) {
      return true
    }
  }
  return false
}

function hasInvisibleFormatCharacter(value: string): boolean {
  return /\p{Cf}/u.test(value)
}

function requestsUserAvatarControl(value: string): boolean {
  return userAvatarBoundaryPattern.test(value)
    || (userAvatarActionPattern.test(value) && userAvatarSubjectPattern.test(value))
}

function parseRadius(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined)
    return fallback
  const radius = Number(value)
  return Number.isFinite(radius) && radius >= 0.5 && radius <= 64 ? radius : undefined
}

function parseFollowCommand(command: string): MinecraftAgentAction | undefined {
  const match = followPattern.exec(command)
  if (!match)
    return undefined
  const radius = parseRadius(match[2], DEFAULT_FOLLOW_RADIUS)
  return radius === undefined
    ? undefined
    : { kind: 'follow-player', playerId: match[1]!, radius }
}

function parseMoveCommand(command: string): MinecraftAgentAction | undefined {
  const match = movePattern.exec(command)
  if (!match)
    return undefined
  const radius = parseRadius(match[2], DEFAULT_MOVE_RADIUS)
  return radius === undefined
    ? undefined
    : { kind: 'move-to-player', playerId: match[1]!, radius }
}

function parseChatCommand(command: string): MinecraftAgentAction | undefined {
  const match = chatPattern.exec(command)
  if (!match)
    return undefined

  const message = match[1]!
  if (
    message.length > MAX_CHAT_MESSAGE_LENGTH
    || message.startsWith(' ')
    || message.startsWith('/')
    || !safeChatMessagePattern.test(message)
  ) {
    return undefined
  }

  return { kind: 'send-chat', message }
}

/**
 * Converts the small Spark command vocabulary into a structured action.
 * Unknown text is deliberately dropped instead of being forwarded to an executor.
 */
function parseAllowlistedCommand(input: unknown): MinecraftAgentAction | undefined {
  if (typeof input !== 'string' || hasControlCharacter(input))
    return undefined
  if (/^\s|\s$/u.test(input))
    return undefined

  const command = input
  if (command.length === 0 || command.startsWith('/'))
    return undefined

  const follow = parseFollowCommand(command)
  if (follow)
    return follow

  const move = parseMoveCommand(command)
  if (move)
    return move

  const look = lookPattern.exec(command)
  if (look)
    return { kind: 'look-at', playerId: look[1]! }

  if (/^jump$/i.test(command))
    return { kind: 'jump' }

  return parseChatCommand(command)
}

export function routeMinecraftCommand(input: unknown): MinecraftCommandRoute {
  if (
    typeof input !== 'string'
    || input.length === 0
    || input.length > MAX_SPARK_COMMAND_LENGTH
    || hasControlCharacter(input)
    || hasInvisibleFormatCharacter(input)
  ) {
    return { kind: 'blocked', errorCode: 'invalid-contract' }
  }

  const action = parseAllowlistedCommand(input)
  if (action)
    return { kind: 'action', action }
  if (requestsUserAvatarControl(input))
    return { kind: 'blocked', errorCode: 'user-avatar-control-forbidden' }
  if (
    /^\s|\s$/u.test(input)
    || input.startsWith('/')
    || reservedCommandPrefixPattern.test(input)
    || dangerousCommandPattern.test(input)
  ) {
    return { kind: 'blocked', errorCode: 'arbitrary-command-forbidden' }
  }
  return { kind: 'fallback' }
}

export function parseMinecraftCommand(input: unknown): MinecraftAgentAction | undefined {
  const route = routeMinecraftCommand(input)
  return route.kind === 'action' ? route.action : undefined
}
