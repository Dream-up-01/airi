import type { ElectronCompanionPresetFile } from '../../shared/eventa'

import { parse as parseYaml } from 'yaml'

/**
 * Parses a sanitized companion preset file payload from Electron main.
 *
 * Use when:
 * - The settings renderer receives a size-limited UTF-8 YAML or JSON file.
 *
 * Expects:
 * - `fileName` is a basename ending in `.json`, `.yaml`, or `.yml`.
 * - Duplicate YAML keys and excessive aliases are rejected.
 *
 * Returns:
 * - An untrusted JavaScript value that must still pass companion preset validation.
 */
export function parseCompanionPresetFile(file: ElectronCompanionPresetFile): unknown {
  if (file.fileName.toLowerCase().endsWith('.json')) {
    // JSON.parse silently accepts duplicate object keys. Parse once through
    // the existing YAML parser's JSON-compatible grammar to enforce unique
    // keys, then use JSON.parse to retain strict JSON syntax and semantics.
    parseYaml(file.content, {
      maxAliasCount: 0,
      uniqueKeys: true,
    })
    return JSON.parse(file.content)
  }

  if (!/\.ya?ml$/iu.test(file.fileName))
    throw new Error('Unsupported companion preset extension.')

  return parseYaml(file.content, {
    maxAliasCount: 20,
    uniqueKeys: true,
  })
}
