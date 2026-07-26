import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { ElectronCharacterSourcePickResult } from '../../../shared/eventa'

import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import JSZip from 'jszip'

import { defineInvokeHandler } from '@moeru/eventa'
import { dialog } from 'electron'

import { electronCharacterSourceCancel, electronCharacterSourcePickFile } from '../../../shared/eventa'

const maxTextSourceFileBytes = 1_000_000
const maxDocxSourceFileBytes = 10_000_000
const maxExtractedSourceCharacters = 1_000_000
const formatByExtension = {
  '.docx': 'docx',
  '.json': 'json',
  '.md': 'md',
  '.text': 'plain-text',
  '.txt': 'txt',
  '.yaml': 'yaml',
  '.yml': 'yaml',
} as const

function decodeXmlText(value: string): string {
  return value.replace(/&(?:amp|apos|gt|lt|quot|#\d+|#x[\da-f]+);/giu, (entity) => {
    switch (entity.toLowerCase()) {
      case '&amp;': return '&'
      case '&apos;': return '\''
      case '&gt;': return '>'
      case '&lt;': return '<'
      case '&quot;': return '"'
      default: {
        const hexadecimal = entity[2]?.toLowerCase() === 'x'
        const digits = entity.slice(hexadecimal ? 3 : 2, -1)
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10)
        return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
          ? String.fromCodePoint(codePoint)
          : entity
      }
    }
  })
}

function wordXmlToPlainText(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml))
    throw new Error('Unsupported DOCX XML declaration')

  const output: string[] = []
  let insideText = false
  for (const token of xml.matchAll(/<[^>]+>|[^<]+/gu)) {
    const value = token[0]
    if (!value.startsWith('<')) {
      if (insideText)
        output.push(decodeXmlText(value))
      continue
    }

    if (value.startsWith('</')) {
      const localName = value.match(/^<\/(?:[\w.-]+:)?([\w.-]+)/u)?.[1]?.toLowerCase()
      if (localName === 't')
        insideText = false
      else if (localName === 'p')
        output.push('\n')
      else if (localName === 'tc' && output.at(-1) !== '\n')
        output.push('\t')
      continue
    }

    const localName = value.match(/^<(?:[\w.-]+:)?([\w.-]+)/u)?.[1]?.toLowerCase()
    if (localName === 't')
      insideText = !/\/>\s*$/u.test(value)
    else if (localName === 'tab')
      output.push('\t')
    else if (localName === 'br' || localName === 'cr')
      output.push('\n')
  }

  return output.join('').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
}

/** Extracts visible WordprocessingML text without evaluating links or macros. */
export async function extractDocxText(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  if (signal.aborted)
    throw signal.reason
  const archive = await JSZip.loadAsync(bytes)
  if (signal.aborted)
    throw signal.reason
  const documentXml = archive.file('word/document.xml')
  if (!documentXml)
    throw new Error('DOCX document part is missing')
  const xml = await documentXml.async('string')
  if (signal.aborted)
    throw signal.reason
  const text = wordXmlToPlainText(xml)
  if (!text || text.length > maxExtractedSourceCharacters)
    throw new Error('DOCX extracted text is empty or too large')
  return text
}

interface CharacterSourceFileSnapshot {
  identity?: string
  modifiedAt: number
  size: number
}

/** External native and filesystem boundaries used by the source reader. */
export interface CharacterSourceFileReaderDependencies {
  /** Converts a bounded DOCX archive into plain evidence text. */
  extractDocxText: (bytes: Uint8Array, signal: AbortSignal) => Promise<string>
  /** Produces a local SHA-256 digest without sending source bytes elsewhere. */
  hashBytes: (bytes: Uint8Array) => string
  /** Shows a native picker; cancellation may be observed after the dialog resolves. */
  pickFile: (signal: AbortSignal) => Promise<string | undefined>
  /** Performs a bounded read and checks `signal` between chunks. */
  readFileBytes: (path: string, byteLimit: number, signal: AbortSignal) => Promise<Uint8Array>
  /** Captures file identity, size, and modification time around the read. */
  readFileSnapshot: (path: string) => Promise<CharacterSourceFileSnapshot>
}

function isValidRequestId(requestId: string): boolean {
  return /^[a-z0-9][\w.:-]{0,159}$/iu.test(requestId)
}

/**
 * Creates a request-scoped UTF-8 source reader with size, race, and
 * cancellation enforcement. Absolute paths never appear in its result.
 */
export function createCharacterSourceFileReader(dependencies: CharacterSourceFileReaderDependencies) {
  return async (requestId: string, signal: AbortSignal): Promise<ElectronCharacterSourcePickResult> => {
    if (!isValidRequestId(requestId))
      return { status: 'error', error: 'invalid_request' }

    const path = await dependencies.pickFile(signal)
    if (!path || signal.aborted)
      return { status: 'cancelled' }

    const extension = extname(path).toLocaleLowerCase()
    const format = formatByExtension[extension as keyof typeof formatByExtension]
    if (!format)
      return { status: 'error', error: 'unsupported_extension' }
    const byteLimit = format === 'docx' ? maxDocxSourceFileBytes : maxTextSourceFileBytes

    let before: CharacterSourceFileSnapshot
    try {
      before = await dependencies.readFileSnapshot(path)
    }
    catch {
      return { status: 'error', error: 'stat_failed' }
    }
    if (before.size > byteLimit)
      return { status: 'error', error: 'file_too_large' }

    let bytes: Uint8Array
    try {
      bytes = await dependencies.readFileBytes(path, byteLimit + 1, signal)
    }
    catch {
      return signal.aborted ? { status: 'cancelled' } : { status: 'error', error: 'read_failed' }
    }
    if (signal.aborted)
      return { status: 'cancelled' }
    if (bytes.byteLength > byteLimit)
      return { status: 'error', error: 'file_changed_during_read' }

    let after: CharacterSourceFileSnapshot
    try {
      after = await dependencies.readFileSnapshot(path)
    }
    catch {
      return { status: 'error', error: 'stat_failed' }
    }
    if (before.size !== after.size || before.modifiedAt !== after.modifiedAt || before.identity !== after.identity)
      return { status: 'error', error: 'file_changed_during_read' }

    let content: string
    if (format === 'docx') {
      try {
        content = await dependencies.extractDocxText(bytes, signal)
      }
      catch {
        return signal.aborted ? { status: 'cancelled' } : { status: 'error', error: 'invalid_docx' }
      }
    }
    else {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      }
      catch {
        return { status: 'error', error: 'invalid_utf8' }
      }
    }

    return {
      status: 'selected',
      file: {
        content,
        contentHash: dependencies.hashBytes(bytes),
        fileName: basename(path),
        format,
      },
    }
  }
}

/** Registers cancellable source-file selection for the settings renderer. */
export function createCharacterSourceFileService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
}) {
  const activeRequests = new Map<string, AbortController>()

  async function readBoundedFile(path: string, byteLimit: number, signal: AbortSignal): Promise<Uint8Array> {
    const handle = await open(path, 'r')
    try {
      const bytes = new Uint8Array(byteLimit)
      let offset = 0
      while (offset < byteLimit) {
        if (signal.aborted)
          throw signal.reason
        const result = await handle.read(bytes, offset, Math.min(64 * 1024, byteLimit - offset), offset)
        if (result.bytesRead === 0)
          break
        offset += result.bytesRead
      }
      return bytes.subarray(0, offset)
    }
    finally {
      await handle.close()
    }
  }

  const readSource = createCharacterSourceFileReader({
    extractDocxText,
    hashBytes: bytes => createHash('sha256').update(bytes).digest('hex'),
    pickFile: async () => {
      const result = await dialog.showOpenDialog(params.window, {
        properties: ['openFile'],
        filters: [{ name: 'Character source document', extensions: ['docx', 'txt', 'text', 'md', 'json', 'yaml', 'yml'] }],
      })
      return result.canceled ? undefined : result.filePaths[0]
    },
    readFileBytes: readBoundedFile,
    readFileSnapshot: async (path) => {
      const snapshot = await stat(path)
      return {
        identity: `${snapshot.dev}:${snapshot.ino}`,
        modifiedAt: snapshot.mtimeMs,
        size: snapshot.size,
      }
    },
  })

  params.window.once('closed', () => {
    for (const controller of activeRequests.values())
      controller.abort('settings-window-closed')
    activeRequests.clear()
  })

  defineInvokeHandler(params.context, electronCharacterSourcePickFile, async (payload) => {
    const requestId = payload?.requestId ?? ''
    activeRequests.get(requestId)?.abort('superseded-request')
    const controller = new AbortController()
    activeRequests.set(requestId, controller)
    try {
      return await readSource(requestId, controller.signal)
    }
    finally {
      if (activeRequests.get(requestId) === controller)
        activeRequests.delete(requestId)
    }
  })
  return defineInvokeHandler(params.context, electronCharacterSourceCancel, (payload) => {
    const requestId = payload?.requestId ?? ''
    activeRequests.get(requestId)?.abort('renderer-cancelled')
    activeRequests.delete(requestId)
  })
}
