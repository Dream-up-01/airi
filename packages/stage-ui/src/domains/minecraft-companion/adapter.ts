import type { MinecraftActionExecutionContext, MinecraftActionResult, MinecraftAgentAction } from './contracts'

export interface MinecraftAgentExecutorAdapter {
  readonly adapterId: string
  supports: (action: MinecraftAgentAction) => boolean
  execute: (action: MinecraftAgentAction, context: MinecraftActionExecutionContext) => Promise<MinecraftActionResult>
  cancel: (intentId: string, context: MinecraftActionExecutionContext) => Promise<void>
}
