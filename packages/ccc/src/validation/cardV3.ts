import type { BaseIssue, InferOutput } from 'valibot'

import { getMetadata } from 'meta-png'
import {
  array,
  boolean,
  finite,
  integer,
  literal,
  maxLength,
  maxValue,
  minValue,
  number,
  optional,
  picklist,
  pipe,
  record,
  safeParse,
  strictObject,
  string,
  union,
  unknown,
} from 'valibot'

const shortText = pipe(string(), maxLength(512, 'Value must not exceed 512 characters.'))
const paragraph = pipe(string(), maxLength(64_000, 'Value must not exceed 64000 characters.'))
const stringList = pipe(array(shortText), maxLength(4_096, 'List must not contain more than 4096 values.'))
const finiteNumber = pipe(number(), finite('Number must be finite.'))
const nonNegativeInteger = pipe(finiteNumber, integer('Number must be an integer.'), minValue(0, 'Number must not be negative.'))
const extensions = record(string(), unknown())

/** Runtime schema for one standard CCv3 lorebook entry. */
export const CharacterBookEntrySchema = strictObject({
  case_sensitive: optional(boolean()),
  comment: optional(paragraph),
  constant: optional(boolean()),
  content: paragraph,
  enabled: boolean(),
  extensions,
  id: optional(union([finiteNumber, shortText])),
  insertion_order: pipe(finiteNumber, integer('Insertion order must be an integer.')),
  keys: pipe(array(shortText), maxLength(64, 'Lorebook entry must not contain more than 64 primary keys.')),
  name: optional(shortText),
  position: optional(picklist(['after_char', 'before_char'])),
  priority: optional(pipe(finiteNumber, integer('Priority must be an integer.'))),
  secondary_keys: optional(pipe(array(shortText), maxLength(64, 'Lorebook entry must not contain more than 64 secondary keys.'))),
  selective: optional(boolean()),
  use_regex: optional(boolean()),
})

/** Runtime schema for a bounded standard CCv3 character lorebook. */
export const CharacterBookSchema = strictObject({
  description: optional(paragraph),
  entries: pipe(array(CharacterBookEntrySchema), maxLength(2_048, 'Lorebook must not contain more than 2048 entries.')),
  extensions,
  name: optional(shortText),
  recursive_scanning: optional(boolean()),
  scan_depth: optional(pipe(nonNegativeInteger, maxValue(256, 'Scan depth must not exceed 256 messages.'))),
  token_budget: optional(pipe(nonNegativeInteger, maxValue(1_000_000, 'Token budget is outside the supported range.'))),
})

const AssetSchema = strictObject({
  ext: shortText,
  name: shortText,
  type: shortText,
  uri: paragraph,
})

/** Runtime schema for the currently supported Character Card V3 contract. */
export const CharacterCardV3Schema = strictObject({
  spec: literal('chara_card_v3'),
  spec_version: literal('3.0'),
  data: strictObject({
    alternate_greetings: stringList,
    assets: optional(pipe(array(AssetSchema), maxLength(1_024, 'Card must not contain more than 1024 assets.'))),
    character_book: optional(CharacterBookSchema),
    character_version: shortText,
    creation_date: optional(nonNegativeInteger),
    creator: shortText,
    creator_notes: paragraph,
    creator_notes_multilingual: optional(record(shortText, paragraph)),
    description: paragraph,
    extensions,
    first_mes: paragraph,
    group_only_greetings: stringList,
    mes_example: paragraph,
    modification_date: optional(nonNegativeInteger),
    name: shortText,
    nickname: optional(shortText),
    personality: paragraph,
    post_history_instructions: paragraph,
    scenario: paragraph,
    source: optional(stringList),
    system_prompt: paragraph,
    tags: stringList,
  }),
})

/** Resource ceilings applied before parsed card data reaches application state. */
export interface CharacterCardV3ValidationLimits {
  /** Maximum UTF-8 JSON byte length. @default 2 MiB */
  maxJsonBytes: number
  /** Maximum PNG container size accepted for metadata import. @default 16 MiB */
  maxPngBytes: number
  /** Maximum nested JSON object/array depth. @default 24 */
  maxDepth: number
  /** Maximum total object properties and array elements. @default 50,000 */
  maxNodes: number
  /** Maximum properties accepted on one object. @default 512 */
  maxObjectKeys: number
  /** Maximum values accepted in one array before field-specific validation. @default 4,096 */
  maxArrayLength: number
}

/** Stable validation categories used by card import UI. */
export type CharacterCardV3ValidationCode
  = | 'invalid_json'
    | 'invalid_json_value'
    | 'invalid_schema'
    | 'missing_png_metadata'
    | 'resource_limit'
    | 'unsafe_key'

/** One actionable CCv3 import failure without copying card content. */
export interface CharacterCardV3ValidationError {
  /** Stable localization and diagnostics key. */
  code: CharacterCardV3ValidationCode
  /** Human-readable reason safe to display locally. */
  message: string
  /** Dot-separated field location; `$` identifies the card root. */
  path: string
  /** Concrete repair action. */
  suggestion: string
}

/** Deterministic result returned by CCv3 validation and JSON parsing. */
export type CharacterCardV3ValidationResult
  = | { success: true, value: InferOutput<typeof CharacterCardV3Schema> }
    | { success: false, errors: CharacterCardV3ValidationError[] }

/** Deterministic validation result for a standalone standard lorebook. */
export type CharacterBookValidationResult
  = | { success: true, value: InferOutput<typeof CharacterBookSchema> }
    | { success: false, errors: CharacterCardV3ValidationError[] }

/** Error thrown when a typed application boundary receives invalid CCv3 data. */
export class CharacterCardV3ValidationException extends Error {
  /** Structured failures safe for local UI and diagnostics. */
  readonly errors: CharacterCardV3ValidationError[]

  constructor(errors: CharacterCardV3ValidationError[]) {
    super('Character Card V3 validation failed.')
    this.name = 'CharacterCardV3ValidationException'
    this.errors = errors
  }
}

/** Error thrown when a neutral Card contains an invalid standard lorebook. */
export class CharacterBookValidationException extends Error {
  readonly errors: CharacterCardV3ValidationError[]

  constructor(errors: CharacterCardV3ValidationError[]) {
    super('Character book validation failed.')
    this.name = 'CharacterBookValidationException'
    this.errors = errors
  }
}

const defaultLimits: CharacterCardV3ValidationLimits = {
  maxJsonBytes: 2 * 1_024 * 1_024,
  maxPngBytes: 16 * 1_024 * 1_024,
  maxDepth: 24,
  maxNodes: 50_000,
  maxObjectKeys: 512,
  maxArrayLength: 4_096,
}

function issuePath(issue: BaseIssue<unknown>): string {
  if (!issue.path?.length)
    return '$'
  return issue.path.map(item => String(item.key)).join('.')
}

function inspectJsonValue(input: unknown, limits: CharacterCardV3ValidationLimits): CharacterCardV3ValidationError[] {
  const errors: CharacterCardV3ValidationError[] = []
  const pending: Array<{ depth: number, path: string, value: unknown }> = [{ depth: 0, path: '$', value: input }]
  let nodes = 0

  while (pending.length > 0) {
    const current = pending.pop()!
    nodes++
    if (nodes > limits.maxNodes) {
      errors.push({
        code: 'resource_limit',
        message: `Card JSON exceeds the ${limits.maxNodes} node limit.`,
        path: '$',
        suggestion: 'Remove unnecessary nested extension or lorebook data.',
      })
      break
    }
    if (current.depth > limits.maxDepth) {
      errors.push({
        code: 'resource_limit',
        message: `Card JSON exceeds the ${limits.maxDepth} level nesting limit.`,
        path: current.path,
        suggestion: 'Flatten deeply nested extension data.',
      })
      continue
    }

    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean')
      continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        errors.push({
          code: 'invalid_json_value',
          message: 'Card contains a non-finite number.',
          path: current.path,
          suggestion: 'Replace the value with a finite JSON number.',
        })
      }
      continue
    }
    if (typeof current.value !== 'object') {
      errors.push({
        code: 'invalid_json_value',
        message: 'Card contains a value that cannot be represented in JSON.',
        path: current.path,
        suggestion: 'Use only JSON objects, arrays, strings, numbers, booleans, and null.',
      })
      continue
    }

    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayLength) {
        errors.push({
          code: 'resource_limit',
          message: `Array exceeds the ${limits.maxArrayLength} item limit.`,
          path: current.path,
          suggestion: 'Remove duplicate or unnecessary list values.',
        })
        continue
      }
      for (let index = current.value.length - 1; index >= 0; index--) {
        pending.push({ depth: current.depth + 1, path: `${current.path}.${index}`, value: current.value[index] })
      }
      continue
    }

    const object = current.value as Record<string, unknown>
    const prototype = Object.getPrototypeOf(object)
    if (prototype !== Object.prototype && prototype !== null) {
      errors.push({
        code: 'unsafe_key',
        message: 'Card contains an object with a non-standard prototype.',
        path: current.path,
        suggestion: 'Use plain JSON objects for card and extension data.',
      })
      continue
    }
    if (Object.getOwnPropertySymbols(object).length > 0) {
      errors.push({
        code: 'invalid_json_value',
        message: 'Card contains symbol-keyed data that JSON cannot represent.',
        path: current.path,
        suggestion: 'Use string property names for all card and extension data.',
      })
      continue
    }
    const keys = Object.keys(object)
    if (keys.length > limits.maxObjectKeys) {
      errors.push({
        code: 'resource_limit',
        message: `Object exceeds the ${limits.maxObjectKeys} property limit.`,
        path: current.path,
        suggestion: 'Remove unnecessary extension properties.',
      })
      continue
    }
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        errors.push({
          code: 'unsafe_key',
          message: 'Card contains an unsafe object property.',
          path: `${current.path}.${key}`,
          suggestion: 'Remove prototype-related property names.',
        })
        continue
      }
      pending.push({ depth: current.depth + 1, path: `${current.path}.${key}`, value: object[key] })
    }
  }

  return errors
}

/** Validates parsed CCv3 data before it reaches Card state. */
export function validateCharacterCardV3(
  input: unknown,
  overrides: Partial<CharacterCardV3ValidationLimits> = {},
): CharacterCardV3ValidationResult {
  const limits = { ...defaultLimits, ...overrides }
  const structuralErrors = inspectJsonValue(input, limits)
  if (structuralErrors.length > 0)
    return { success: false, errors: structuralErrors }

  const result = safeParse(CharacterCardV3Schema, input)
  if (!result.success) {
    return {
      success: false,
      errors: result.issues.map(issue => ({
        code: 'invalid_schema',
        message: issue.message,
        path: issuePath(issue),
        suggestion: 'Correct the field to match the Character Card V3 contract.',
      })),
    }
  }
  return { success: true, value: result.output }
}

/** Validates a standalone lorebook before Card storage or prompt selection. */
export function validateCharacterBook(
  input: unknown,
  overrides: Partial<CharacterCardV3ValidationLimits> = {},
): CharacterBookValidationResult {
  const limits = { ...defaultLimits, ...overrides }
  const structuralErrors = inspectJsonValue(input, limits)
  if (structuralErrors.length > 0)
    return { success: false, errors: structuralErrors }
  const result = safeParse(CharacterBookSchema, input)
  if (!result.success) {
    return {
      success: false,
      errors: result.issues.map(issue => ({
        code: 'invalid_schema',
        message: issue.message,
        path: issuePath(issue),
        suggestion: 'Correct the field to match the Character Card V3 lorebook contract.',
      })),
    }
  }
  return { success: true, value: result.output }
}

/** Returns a validated lorebook or throws a structured exception. */
export function assertCharacterBook(input: unknown): InferOutput<typeof CharacterBookSchema> {
  const result = validateCharacterBook(input)
  if (result.success === false)
    throw new CharacterBookValidationException(result.errors)
  return result.value
}

/** Returns validated CCv3 data or throws a structured validation exception. */
export function assertCharacterCardV3(input: unknown): InferOutput<typeof CharacterCardV3Schema> {
  const result = validateCharacterCardV3(input)
  if (result.success === false)
    throw new CharacterCardV3ValidationException(result.errors)
  return result.value
}

/** Parses and validates bounded UTF-8 Character Card V3 JSON text. */
export function parseCharacterCardV3Json(
  text: string,
  overrides: Partial<CharacterCardV3ValidationLimits> = {},
): CharacterCardV3ValidationResult {
  const limits = { ...defaultLimits, ...overrides }
  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > limits.maxJsonBytes) {
    return {
      success: false,
      errors: [{
        code: 'resource_limit',
        message: `Card JSON exceeds the ${limits.maxJsonBytes} byte limit.`,
        path: '$',
        suggestion: 'Remove oversized embedded data and import assets separately.',
      }],
    }
  }

  let input: unknown
  try {
    input = JSON.parse(text)
  }
  catch {
    return {
      success: false,
      errors: [{
        code: 'invalid_json',
        message: 'Card file is not valid JSON.',
        path: '$',
        suggestion: 'Fix the JSON syntax and try importing the file again.',
      }],
    }
  }
  return validateCharacterCardV3(input, limits)
}

/** Extracts, decodes, and validates a CCv3 card embedded in PNG metadata. */
export function parseCharacterCardV3Png(
  png: Uint8Array,
  overrides: Partial<CharacterCardV3ValidationLimits> = {},
): CharacterCardV3ValidationResult {
  const limits = { ...defaultLimits, ...overrides }
  if (png.byteLength > limits.maxPngBytes) {
    return {
      success: false,
      errors: [{
        code: 'resource_limit',
        message: `Card PNG exceeds the ${limits.maxPngBytes} byte limit.`,
        path: '$',
        suggestion: 'Use a smaller PNG image and import large assets separately.',
      }],
    }
  }

  let encodedCard: string | undefined
  try {
    encodedCard = getMetadata(png, 'ccv3')
  }
  catch {
    return {
      success: false,
      errors: [{
        code: 'invalid_json_value',
        message: 'The PNG container is malformed.',
        path: '$',
        suggestion: 'Export the character card from a compatible CCv3 application and try again.',
      }],
    }
  }
  if (!encodedCard) {
    return {
      success: false,
      errors: [{
        code: 'missing_png_metadata',
        message: 'The PNG does not contain ccv3 character-card metadata.',
        path: '$.ccv3',
        suggestion: 'Choose a CCv3 character-card PNG or import its JSON export.',
      }],
    }
  }

  try {
    const binary = atob(encodedCard)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return parseCharacterCardV3Json(text, limits)
  }
  catch {
    return {
      success: false,
      errors: [{
        code: 'invalid_json_value',
        message: 'The ccv3 PNG metadata is not valid base64-encoded UTF-8.',
        path: '$.ccv3',
        suggestion: 'Export the character card again from a compatible CCv3 application.',
      }],
    }
  }
}
