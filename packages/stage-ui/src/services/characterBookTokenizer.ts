export type CharacterBookTokenCounter = (text: string) => number

export type CharacterBookTokenizerStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'failed'
export type CharacterBookTokenizerKind = 'tiktoken-o200k' | 'tiktoken-cl100k' | 'huggingface'
export type CharacterBookTokenizerReason
  = | 'missing-provider-or-model'
    | 'model-not-mapped'
    | 'tokenizer-load-failed'

export interface CharacterBookTokenizerSnapshot {
  providerId?: string
  modelId?: string
  status: CharacterBookTokenizerStatus
  kind?: CharacterBookTokenizerKind
  exact: boolean
  reason?: CharacterBookTokenizerReason
}

interface TokenizerDescriptor {
  cacheKey: string
  kind: CharacterBookTokenizerKind
  tokenizerModelId?: string
}

export interface CharacterBookTokenizerLoaders {
  loadTiktoken: (encoding: 'o200k_base' | 'cl100k_base') => Promise<CharacterBookTokenCounter>
  loadHuggingFace: (modelId: string) => Promise<CharacterBookTokenCounter>
}

function normalizedModelName(modelId: string): string {
  return modelId.trim().toLocaleLowerCase('und')
}

function openAiModelName(modelId: string): string {
  const normalized = normalizedModelName(modelId)
  return normalized.startsWith('openai/') ? normalized.slice('openai/'.length) : normalized
}

function isO200kModel(modelId: string): boolean {
  const model = openAiModelName(modelId)
  return /^(?:chatgpt-4o|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o1|o3|o4)(?:$|[-.:])/u.test(model)
}

function isCl100kModel(modelId: string): boolean {
  const model = openAiModelName(modelId)
  return /^(?:gpt-3\.5-turbo|gpt-35-turbo|gpt-4(?:$|[-.:]))/u.test(model)
    && !isO200kModel(model)
}

function isLocalProvider(providerId: string): boolean {
  const provider = providerId.toLocaleLowerCase('und')
  return provider.includes('ollama')
    || provider.includes('lm-studio')
    || provider.includes('local')
}

function isVerifiedOpenAiTokenizerProvider(providerId: string): boolean {
  const provider = providerId.toLocaleLowerCase('und')
  return provider === 'official-provider'
    || provider === 'openrouter-ai'
    || provider === 'azure-openai'
    || provider === 'openai'
}

function explicitHuggingFaceModel(modelId: string): string | undefined {
  const trimmed = modelId.trim()
  const normalized = trimmed.toLocaleLowerCase('und')
  const supportedOrganizations = [
    'deepseek-ai/',
    'google/gemma',
    'meta-llama/',
    'mistralai/',
    'openai/gpt-oss',
    'qwen/',
  ]
  return supportedOrganizations.some(prefix => normalized.startsWith(prefix)) ? trimmed : undefined
}

/** Resolves only known-compatible tokenizer families; unknown models never use an estimate. */
export function resolveCharacterBookTokenizer(
  providerId: string | undefined,
  modelId: string | undefined,
): TokenizerDescriptor | undefined {
  if (!providerId || !modelId)
    return undefined
  if (isVerifiedOpenAiTokenizerProvider(providerId) && isO200kModel(modelId))
    return { cacheKey: 'tiktoken:o200k_base', kind: 'tiktoken-o200k' }
  if (isVerifiedOpenAiTokenizerProvider(providerId) && isCl100kModel(modelId))
    return { cacheKey: 'tiktoken:cl100k_base', kind: 'tiktoken-cl100k' }

  const huggingFaceModelId = isLocalProvider(providerId) ? explicitHuggingFaceModel(modelId) : undefined
  if (huggingFaceModelId) {
    return {
      cacheKey: `huggingface:${huggingFaceModelId}`,
      kind: 'huggingface',
      tokenizerModelId: huggingFaceModelId,
    }
  }
  return undefined
}

async function loadTiktoken(encoding: 'o200k_base' | 'cl100k_base'): Promise<CharacterBookTokenCounter> {
  const [{ Tiktoken }, ranks] = await Promise.all([
    import('js-tiktoken/lite'),
    encoding === 'o200k_base'
      ? import('js-tiktoken/ranks/o200k_base')
      : import('js-tiktoken/ranks/cl100k_base'),
  ])
  const tokenizer = new Tiktoken(ranks.default)
  return text => tokenizer.encode(text).length
}

async function loadHuggingFace(modelId: string): Promise<CharacterBookTokenCounter> {
  const { AutoTokenizer } = await import('@huggingface/transformers')
  const tokenizer = await AutoTokenizer.from_pretrained(modelId)
  return text => tokenizer.encode(text, { add_special_tokens: false }).length
}

const defaultLoaders: CharacterBookTokenizerLoaders = {
  loadHuggingFace,
  loadTiktoken,
}

function requestKey(providerId: string | undefined, modelId: string | undefined): string {
  return `${providerId ?? ''}\u0000${modelId ?? ''}`
}

/**
 * Provider/model-aware lazy tokenizer registry. It never receives prompt text
 * until the caller invokes a ready counter and never guesses token counts.
 */
export class CharacterBookTokenizerRegistry {
  private readonly counters = new Map<string, CharacterBookTokenCounter>()
  private readonly pendingLoads = new Map<string, Promise<CharacterBookTokenCounter>>()
  private readonly snapshots = new Map<string, CharacterBookTokenizerSnapshot>()

  constructor(private readonly loaders: CharacterBookTokenizerLoaders = defaultLoaders) {}

  snapshot(providerId?: string, modelId?: string): CharacterBookTokenizerSnapshot {
    return this.snapshots.get(requestKey(providerId, modelId)) ?? {
      providerId,
      modelId,
      status: 'idle',
      exact: false,
      reason: providerId && modelId ? undefined : 'missing-provider-or-model',
    }
  }

  counter(providerId?: string, modelId?: string): CharacterBookTokenCounter | undefined {
    const descriptor = resolveCharacterBookTokenizer(providerId, modelId)
    return descriptor ? this.counters.get(descriptor.cacheKey) : undefined
  }

  async prepare(providerId?: string, modelId?: string): Promise<CharacterBookTokenizerSnapshot> {
    const key = requestKey(providerId, modelId)
    if (!providerId || !modelId) {
      const snapshot: CharacterBookTokenizerSnapshot = {
        providerId,
        modelId,
        status: 'unsupported',
        exact: false,
        reason: 'missing-provider-or-model',
      }
      this.snapshots.set(key, snapshot)
      return snapshot
    }

    const descriptor = resolveCharacterBookTokenizer(providerId, modelId)
    if (!descriptor) {
      const snapshot: CharacterBookTokenizerSnapshot = {
        providerId,
        modelId,
        status: 'unsupported',
        exact: false,
        reason: 'model-not-mapped',
      }
      this.snapshots.set(key, snapshot)
      return snapshot
    }

    const readyCounter = this.counters.get(descriptor.cacheKey)
    if (readyCounter) {
      const snapshot: CharacterBookTokenizerSnapshot = {
        providerId,
        modelId,
        status: 'ready',
        kind: descriptor.kind,
        exact: true,
      }
      this.snapshots.set(key, snapshot)
      return snapshot
    }

    this.snapshots.set(key, {
      providerId,
      modelId,
      status: 'loading',
      kind: descriptor.kind,
      exact: false,
    })

    let pending = this.pendingLoads.get(descriptor.cacheKey)
    if (!pending) {
      pending = descriptor.kind === 'tiktoken-o200k'
        ? this.loaders.loadTiktoken('o200k_base')
        : descriptor.kind === 'tiktoken-cl100k'
          ? this.loaders.loadTiktoken('cl100k_base')
          : this.loaders.loadHuggingFace(descriptor.tokenizerModelId!)
      this.pendingLoads.set(descriptor.cacheKey, pending)
    }

    try {
      const counter = await pending
      this.counters.set(descriptor.cacheKey, counter)
      const snapshot: CharacterBookTokenizerSnapshot = {
        providerId,
        modelId,
        status: 'ready',
        kind: descriptor.kind,
        exact: true,
      }
      this.snapshots.set(key, snapshot)
      return snapshot
    }
    catch {
      const snapshot: CharacterBookTokenizerSnapshot = {
        providerId,
        modelId,
        status: 'failed',
        kind: descriptor.kind,
        exact: false,
        reason: 'tokenizer-load-failed',
      }
      this.snapshots.set(key, snapshot)
      return snapshot
    }
    finally {
      this.pendingLoads.delete(descriptor.cacheKey)
    }
  }
}

export const characterBookTokenizerRegistry = new CharacterBookTokenizerRegistry()
