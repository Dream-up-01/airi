/** Trusted formatting rules shared by persisted sessions and per-turn prompt composition. */
export const CHAT_FORMATTING_SYSTEM_PROMPT = [
  '- For any programming code block, always specify the programming language supported by @shikijs/rehype, for example ```python ... ```.',
  '- For any math equation, use LaTeX such as $ x^3 $ and escape dollar signs outside math equations.',
].join('\n')

/** Creates the persisted fallback system prompt for sessions loaded without runtime composition. */
export function createStoredSystemPrompt(characterPrompt: string): string {
  return [CHAT_FORMATTING_SYSTEM_PROMPT, characterPrompt].filter(Boolean).join('\n\n')
}
