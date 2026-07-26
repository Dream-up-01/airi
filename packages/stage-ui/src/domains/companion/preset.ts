import type { BaseIssue, InferOutput } from 'valibot'

import {
  array,
  boolean,
  literal,
  maxLength,
  minLength,
  nonEmpty,
  optional,
  picklist,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
  trim,
} from 'valibot'

const identifier = pipe(
  string(),
  trim(),
  nonEmpty('Preset ID is required.'),
  maxLength(128, 'Preset ID must not exceed 128 characters.'),
  regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Preset ID must use lowercase letters, numbers, dots, underscores, or hyphens.'),
)

const semanticVersion = pipe(
  string(),
  trim(),
  regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*))*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i, 'Version must be a semantic version such as 1.0.0.'),
)

const locale = pipe(
  string(),
  trim(),
  regex(/^zh(?:-[a-z0-9]{2,8})*$/i, 'Language must be a Chinese BCP-47-like tag such as zh-CN or zh-Hans.'),
)

const shortText = pipe(string(), trim(), nonEmpty('Value must not be empty.'), maxLength(160, 'Value must not exceed 160 characters.'))
const paragraph = pipe(string(), trim(), nonEmpty('Value must not be empty.'), maxLength(4000, 'Value must not exceed 4000 characters.'))
const prompt = pipe(string(), trim(), nonEmpty('System prompt must not be empty.'), maxLength(16000, 'System prompt must not exceed 16000 characters.'))
const shortTextList = pipe(array(shortText), minLength(1, 'At least one item is required.'), maxLength(32, 'No more than 32 items are allowed.'))

const ModelSelectionSchema = strictObject({
  provider: shortText,
  model: shortText,
})

/**
 * Version 1 schema for a distributable Chinese companion preset.
 *
 * Use when:
 * - Validating parsed YAML or JSON before it reaches AIRI Card state.
 * - Producing a normalized, secret-free companion configuration.
 *
 * Expects:
 * - Unknown fields are rejected so schema drift is visible to users.
 * - Runtime credentials and machine-local paths are not part of this contract.
 *
 * Returns:
 * - A validated version 1 preset with deterministic defaults applied.
 */
export const CompanionPresetV1Schema = strictObject({
  schema_version: literal(1),
  id: identifier,
  version: semanticVersion,
  status: optional(picklist(['prototype', 'stable', 'deprecated']), 'prototype'),
  identity: strictObject({
    name: shortText,
    nickname: optional(shortText),
    language: optional(locale, 'zh-CN'),
    character_type: optional(literal('adult_ai_virtual_companion'), 'adult_ai_virtual_companion'),
    description: paragraph,
    background: optional(pipe(array(paragraph), maxLength(16, 'No more than 16 background facts are allowed.')), []),
  }),
  behavior: strictObject({
    personality: shortTextList,
    primary_scenarios: shortTextList,
    greeting: paragraph,
  }),
  response_policy: optional(strictObject({
    default_language: optional(literal('简体中文'), '简体中文'),
    normal_response_length: optional(pipe(shortText, regex(/^\d{1,2}-\d{1,2}句话$/u, 'Response length must use a range such as 2-5句话.')), '2-5句话'),
    listen_before_advice: optional(boolean(), true),
    avoid_excessive_exclamation_marks: optional(boolean(), true),
    avoid_customer_service_tone: optional(boolean(), true),
    do_not_invent_user_memories: optional(boolean(), true),
  }), {}),
  relationship_policy: optional(strictObject({
    mode: optional(picklist(['companion', 'friend', 'mentor']), 'companion'),
    prohibit_exclusivity: optional(literal(true), true),
    respect_user_autonomy: optional(literal(true), true),
    avoid_replacing_human_relationships: optional(literal(true), true),
  }), {}),
  safety_policy: optional(strictObject({
    prohibit_dependency_induction: optional(literal(true), true),
    prohibit_replacing_real_relationships: optional(literal(true), true),
    prohibit_medical_diagnosis: optional(literal(true), true),
    crisis_mode_required: optional(literal(true), true),
  }), {}),
  model_bindings: optional(strictObject({
    consciousness: optional(ModelSelectionSchema),
    vision: optional(ModelSelectionSchema),
    speech: optional(strictObject({
      provider: shortText,
      model: shortText,
      voice_id: shortText,
    })),
    display_model_id: optional(shortText),
  }), {}),
  presentation: optional(strictObject({
    act_tokens_enabled: optional(boolean(), true),
    default_emotion: optional(shortText),
  }), {}),
  system_prompt: optional(prompt),
})

/**
 * Parsed version 1 companion preset before dynamic defaults are normalized.
 */
export type CompanionPresetV1 = InferOutput<typeof CompanionPresetV1Schema>

/** Recursively marks normalized preset data as immutable at the domain boundary. */
type DeepReadonly<T>
  = T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

/**
 * Companion preset after validation, dynamic defaults, and list normalization.
 */
export type NormalizedCompanionPreset = DeepReadonly<Omit<CompanionPresetV1, 'identity'> & {
  identity: CompanionPresetV1['identity'] & {
    nickname: string
  }
}>

/** Stable validation categories suitable for localized import UI. */
export type CompanionPresetValidationCode
  = | 'forbidden_prompt_override'
    | 'invalid_value'
    | 'missing_required_field'
    | 'sensitive_value'
    | 'unknown_field'
    | 'unsupported_schema_version'

/** Stable repair actions associated with companion preset validation failures. */
export type CompanionPresetValidationSuggestion
  = | 'correct_field_value'
    | 'provide_required_value'
    | 'remove_sensitive_value'
    | 'remove_unknown_field'
    | 'remove_unsafe_prompt_instruction'
    | 'use_schema_version_1'

/** Model slot that may be requested by a companion preset. */
export type CompanionModelBindingKind = 'consciousness' | 'display' | 'speech' | 'vision'

/** Non-fatal binding issue resolved by retaining the user's current selection. */
export interface CompanionModelBindingWarning {
  /** Model slot that could not use the requested binding. */
  binding: CompanionModelBindingKind
  /** Stable reason suitable for localized UI. */
  code: 'display_model_unavailable' | 'model_unavailable' | 'provider_unavailable'
  /** Provider/model or display-model identifier requested by the preset. */
  requested: string
}

/**
 * One actionable validation failure associated with a preset field.
 */
export interface CompanionPresetValidationError {
  /** Stable product-level error category used for localization and diagnostics. */
  code: CompanionPresetValidationCode
  /** Human-readable explanation suitable for an import preview. */
  message: string
  /** Dot-separated field path; `$` identifies the preset root. */
  path: string
  /** Stable repair action that the import UI can localize. */
  suggestion: CompanionPresetValidationSuggestion
}

/**
 * Result returned by companion preset validation.
 */
export type CompanionPresetValidationResult
  = | { success: true, value: NormalizedCompanionPreset }
    | { errors: CompanionPresetValidationError[], success: false }

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * Normalizes a validated companion preset.
 *
 * Before:
 * - `{ identity: { name: " 栖遥 " }, behavior: { personality: ["温和", "温和"] } }`
 *
 * After:
 * - `{ identity: { name: "栖遥", nickname: "栖遥" }, behavior: { personality: ["温和"] } }`
 */
export function normalizeCompanionPreset(preset: CompanionPresetV1): NormalizedCompanionPreset {
  return {
    ...preset,
    identity: {
      ...preset.identity,
      nickname: preset.identity.nickname ?? preset.identity.name,
    },
    behavior: {
      ...preset.behavior,
      personality: unique(preset.behavior.personality),
      primary_scenarios: unique(preset.behavior.primary_scenarios),
    },
  }
}

function issuePath(issue: BaseIssue<unknown>): string {
  if (!issue.path?.length)
    return '$'

  return issue.path.map(item => String(item.key)).join('.')
}

function validationErrorFromIssue(issue: BaseIssue<unknown>): CompanionPresetValidationError {
  const path = issuePath(issue)

  if (path === 'schema_version' && issue.type === 'literal') {
    return {
      code: 'unsupported_schema_version',
      message: 'Only schema_version 1 is supported; migrate the preset before importing it.',
      path,
      suggestion: 'use_schema_version_1',
    }
  }

  if (issue.type === 'strict_object' && issue.expected === 'never') {
    return {
      code: 'unknown_field',
      message: `Field "${path}" is not supported and must be removed.`,
      path,
      suggestion: 'remove_unknown_field',
    }
  }

  if (issue.type === 'strict_object' && issue.received === 'undefined') {
    return {
      code: 'missing_required_field',
      message: `Required field "${path}" is missing and must be provided.`,
      path,
      suggestion: 'provide_required_value',
    }
  }

  return {
    code: 'invalid_value',
    message: `Field "${path}" is invalid: ${issue.message}`,
    path,
    suggestion: 'correct_field_value',
  }
}

/** Uses UTF-16 code-unit ordering so validation order does not depend on host locale. */
function compareStableText(left: string, right: string): number {
  if (left < right)
    return -1
  if (left > right)
    return 1
  return 0
}

function sortedErrors(errors: CompanionPresetValidationError[]): CompanionPresetValidationError[] {
  return errors.sort((left, right) => compareStableText(left.path, right.path)
    || compareStableText(left.code, right.code)
    || compareStableText(left.message, right.message))
}

function semanticValidationErrors(preset: CompanionPresetV1): CompanionPresetValidationError[] {
  const errors: CompanionPresetValidationError[] = []
  const responseLengthRange = /^(\d{1,2})-(\d{1,2})句话$/u.exec(preset.response_policy.normal_response_length)
  if (responseLengthRange && Number(responseLengthRange[1]) > Number(responseLengthRange[2])) {
    errors.push({
      code: 'invalid_value',
      message: 'response_policy.normal_response_length must place the smaller value first.',
      path: 'response_policy.normal_response_length',
      suggestion: 'correct_field_value',
    })
  }
  const promptTextFields: Array<[path: string, value: string]> = [
    ['identity.name', preset.identity.name],
    ['identity.nickname', preset.identity.nickname ?? ''],
    ['identity.description', preset.identity.description],
    ...preset.identity.background.map((value, index): [string, string] => [`identity.background.${index}`, value]),
    ['behavior.greeting', preset.behavior.greeting],
    ...preset.behavior.personality.map((value, index): [string, string] => [`behavior.personality.${index}`, value]),
    ...preset.behavior.primary_scenarios.map((value, index): [string, string] => [`behavior.primary_scenarios.${index}`, value]),
    ['response_policy.default_language', preset.response_policy.default_language],
    ['response_policy.normal_response_length', preset.response_policy.normal_response_length],
    ['system_prompt', preset.system_prompt ?? ''],
  ]
  const distributableTextFields: Array<[path: string, value: string]> = [
    ...promptTextFields,
    ['model_bindings.consciousness.provider', preset.model_bindings.consciousness?.provider ?? ''],
    ['model_bindings.consciousness.model', preset.model_bindings.consciousness?.model ?? ''],
    ['model_bindings.vision.provider', preset.model_bindings.vision?.provider ?? ''],
    ['model_bindings.vision.model', preset.model_bindings.vision?.model ?? ''],
    ['model_bindings.speech.provider', preset.model_bindings.speech?.provider ?? ''],
    ['model_bindings.speech.model', preset.model_bindings.speech?.model ?? ''],
    ['model_bindings.speech.voice_id', preset.model_bindings.speech?.voice_id ?? ''],
    ['model_bindings.display_model_id', preset.model_bindings.display_model_id ?? ''],
    ['presentation.default_emotion', preset.presentation.default_emotion ?? ''],
  ]

  const credentialAssignment = /(?:api[_ -]?key|access[_ -]?token|访问令牌)\s*[:=：]\s*\S{8,}/iu
  const tokenValue = /\bsk-[\w-]{16,}\b|\bghp_\w{20,}\b|\bgithub_pat_\w{20,}\b|\bAIza[\w-]{20,}\b|\br8_\w{20,}\b/iu
  // Windows drive/UNC paths and common POSIX user/system roots are local
  // implementation details and must never become part of a shared preset.
  const machineLocalPath = /(?:^|[\s"'(【])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|\/(?:Users|Volumes|etc|home|media|mnt|opt|private|tmp|var)(?:\/|$))/iu
  for (const [path, value] of distributableTextFields) {
    if (!credentialAssignment.test(value) && !tokenValue.test(value) && !machineLocalPath.test(value))
      continue

    errors.push({
      code: 'sensitive_value',
      message: `Field "${path}" contains a credential or machine-local path and cannot be distributed.`,
      path,
      suggestion: 'remove_sensitive_value',
    })
  }

  const forbiddenPromptPatterns = [
    /(?:忽略|覆盖|绕过).{0,16}(?:安全|规则|指令|system\s*prompt)/iu,
    /(?:ignore|override|bypass).{0,24}(?:safety|rules?|instructions?|system\s*prompt)/iu,
    /(?:(?:你|角色).{0,8})?(?:能够|可以|已经).{0,8}(?:看到|读取|访问|控制).{0,8}(?:屏幕|摄像头|游戏)/u,
    /(?:you|character).{0,12}(?:can|are\s+able\s+to).{0,12}(?:see|read|access|control).{0,12}(?:screen|camera|game)/iu,
  ]
  for (const [path, value] of promptTextFields) {
    if (!value || !forbiddenPromptPatterns.some(pattern => pattern.test(value)))
      continue

    errors.push({
      code: 'forbidden_prompt_override',
      message: `Field "${path}" attempts to override safety or claim an unavailable perception capability.`,
      path,
      suggestion: 'remove_unsafe_prompt_instruction',
    })
  }

  return sortedErrors(errors)
}

/**
 * Validates and normalizes an unknown companion preset value.
 *
 * Use when:
 * - YAML or JSON has already been parsed at a platform boundary.
 * - Import UI needs stable, field-addressable errors without throwing.
 *
 * Expects:
 * - `input` may be any untrusted JavaScript value.
 *
 * Returns:
 * - A normalized preset on success, or deterministically sorted errors.
 */
export function validateCompanionPreset(input: unknown): CompanionPresetValidationResult {
  const result = safeParse(CompanionPresetV1Schema, input)
  if (result.success) {
    const semanticErrors = semanticValidationErrors(result.output)
    if (semanticErrors.length > 0) {
      return {
        success: false,
        errors: semanticErrors,
      }
    }

    return {
      success: true,
      value: normalizeCompanionPreset(result.output),
    }
  }

  const errors = sortedErrors(result.issues.map(validationErrorFromIssue))

  return {
    success: false,
    errors,
  }
}
