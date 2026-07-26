import { describe, expect, it, vi } from 'vitest'

import { createCompanionPresetFileReader } from './companionPreset'

describe('companion preset file reader', () => {
  it('returns undefined when selection is cancelled', async () => {
    const readFileBytes = vi.fn()
    const read = createCompanionPresetFileReader({
      pickFile: async () => undefined,
      readFileBytes,
      readFileSize: async () => 0,
    })

    expect(await read()).toEqual({ status: 'cancelled' })
    expect(readFileBytes).not.toHaveBeenCalled()
  })

  it('returns basename and normalized UTF-8 content', async () => {
    const readFileBytes = vi.fn(async () => new TextEncoder().encode('\uFEFFschema_version: 1\r\n'))
    const read = createCompanionPresetFileReader({
      pickFile: async () => 'private/presets/qiyao.yaml',
      readFileBytes,
      readFileSize: async () => 22,
    })

    expect(await read()).toEqual({
      status: 'selected',
      file: {
        content: 'schema_version: 1\n',
        fileName: 'qiyao.yaml',
      },
    })
    expect(readFileBytes).toHaveBeenCalledWith('private/presets/qiyao.yaml', 256 * 1024 + 1)
  })

  it('rejects unsupported extensions before file IO', async () => {
    const readFileBytes = vi.fn()
    const read = createCompanionPresetFileReader({
      pickFile: async () => 'private/preset.exe',
      readFileBytes,
      readFileSize: async () => 0,
    })

    await expect(read()).resolves.toEqual({ status: 'error', error: 'unsupported_extension' })
    expect(readFileBytes).not.toHaveBeenCalled()
  })

  it('rejects files larger than 256 KiB', async () => {
    const read = createCompanionPresetFileReader({
      pickFile: async () => 'private/large.yaml',
      readFileBytes: async () => new Uint8Array(0),
      readFileSize: async () => 256 * 1024 + 1,
    })

    await expect(read()).resolves.toEqual({ status: 'error', error: 'file_too_large' })
  })

  it('sanitizes filesystem read errors', async () => {
    const read = createCompanionPresetFileReader({
      pickFile: async () => 'private/unreadable.yaml',
      readFileBytes: async () => {
        throw new Error('EACCES: private/unreadable.yaml')
      },
      readFileSize: async () => 32,
    })

    await expect(read()).resolves.toEqual({ status: 'error', error: 'read_failed' })
  })

  it('returns a stable code for invalid UTF-8', async () => {
    const invalidUtf8 = createCompanionPresetFileReader({
      pickFile: async () => 'private/invalid.yaml',
      readFileBytes: async () => new Uint8Array([0xC3, 0x28]),
      readFileSize: async () => 2,
    })

    await expect(invalidUtf8()).resolves.toEqual({ status: 'error', error: 'invalid_utf8' })
  })

  it('returns a stable code when a file grows during reading', async () => {
    const growingFile = createCompanionPresetFileReader({
      pickFile: async () => 'private/growing.yaml',
      readFileBytes: async () => new Uint8Array(256 * 1024 + 1),
      readFileSize: async () => 1,
    })

    await expect(growingFile()).resolves.toEqual({ status: 'error', error: 'file_changed_too_large' })
  })
})
