/** Stable runtime placement for trusted system-prompt content. */
export type RuntimePromptSlot
  = | 'product-safety'
    | 'tool-authority'
    | 'before-character-lore'
    | 'formatting'
    | 'character'
    | 'after-character-lore'
    | 'turn-policy'

/** One source-addressable system-prompt section composed for a chat turn. */
export interface RuntimePromptSection {
  /** Stable identifier used by prompt inspection. */
  id: string
  /** Trusted placement slot; callers cannot supply numeric priority directly. */
  slot: RuntimePromptSlot
  /** Domain or runtime field that produced this content. */
  source: string
  /** Provider-ready plain text. */
  content: string
}

/** Ordered system prompt plus the exact sections used to produce it. */
export interface CompiledRuntimePrompt {
  /** Sections ordered by non-overridable slot precedence. */
  sections: RuntimePromptSection[]
  /** Provider-ready text assembled from non-empty sections. */
  text: string
}

const slotPriority: Record<RuntimePromptSlot, number> = {
  'product-safety': 0,
  'tool-authority': 10,
  'before-character-lore': 20,
  'formatting': 30,
  'character': 40,
  'after-character-lore': 50,
  'turn-policy': 60,
}

/**
 * Compiles trusted prompt sections without inspecting their text. Slot
 * precedence is fixed here so uploaded lore cannot move ahead of safety.
 */
export function compileRuntimePrompt(sections: readonly RuntimePromptSection[]): CompiledRuntimePrompt {
  const ordered = sections
    .map((section, sourceIndex) => ({ section, sourceIndex }))
    .filter(item => item.section.content.trim().length > 0)
    .sort((left, right) => slotPriority[left.section.slot] - slotPriority[right.section.slot] || left.sourceIndex - right.sourceIndex)
    .map(item => ({ ...item.section, content: item.section.content.trim() }))

  return {
    sections: ordered,
    text: ordered.map(section => section.content).join('\n\n'),
  }
}
