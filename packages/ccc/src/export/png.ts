import type { Card } from '../define'

import { addMetadata, addMetadataFromBase64DataURI } from 'meta-png'

import { exportToJSON } from './json'

/** Encodes validated card data for the Latin-1 PNG metadata container. */
function encodeCardData(data: Card): string {
  const jsonData = exportToJSON(data)
  const jsonString = JSON.stringify(jsonData)
  const encodedData = new TextEncoder().encode(jsonString)
  let binary = ''
  for (let offset = 0; offset < encodedData.length; offset += 0x8000)
    binary += String.fromCharCode(...encodedData.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

/** Embeds a privacy-checked CCv3 card in a PNG `ccv3` metadata chunk. */
export function exportToPNG(data: Card, png: Uint8Array): Uint8Array {
  const encodedData = encodeCardData(data)
  return addMetadata(png, 'ccv3', encodedData)
}

/** Embeds a privacy-checked CCv3 card in a base64 PNG data URI. */
export function exportToPNGBase64(data: Card, png: string): string {
  const encodedData = encodeCardData(data)
  return addMetadataFromBase64DataURI(png, 'ccv3', encodedData)
}
