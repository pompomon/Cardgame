// Deterministic creature-art generator for the Classic, HD fallback, and
// Monochrome assets. Node 24 loads the shared erasable TypeScript recipe module
// directly, so generated Classic PNGs and runtime procedural SVGs use the same
// silhouettes without duplicating catalog slugs.

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import {
  CARD_VISUAL_GRID_SIZE,
  ORDERED_CARD_VISUAL_RECIPES,
} from '../src/app/card-visual-recipes.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUTPUT_ROOT = resolve(HERE, '..', 'public', 'cards')
const DEFAULT_SIZE = 1024
const MINIMUM_SIZE = 256
const MAXIMUM_SIZE = 2048
const GENERATED_STYLES = ['classic', 'hd-fallback', 'monochrome']

const COLOR_ROLES = Object.freeze({
  Forest: {
    dark: '#071b11',
    background: '#17472c',
    primary: '#b9f1c5',
    secondary: '#63c982',
  },
  Island: {
    dark: '#07162f',
    background: '#174272',
    primary: '#b7d9ff',
    secondary: '#62b9ff',
  },
  Mountain: {
    dark: '#260b08',
    background: '#692815',
    primary: '#ffc4a8',
    secondary: '#ff765c',
  },
  Plains: {
    dark: '#2b250c',
    background: '#75652d',
    primary: '#fff2ba',
    secondary: '#f2d15e',
  },
  Swamp: {
    dark: '#14091f',
    background: '#432153',
    primary: '#e0c3ff',
    secondary: '#a96ddb',
  },
})

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBytes = Buffer.from(type, 'ascii')
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([length, typeBytes, data, checksum])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function rgb(hex, alpha = 255) {
  const value = hex.replace('#', '')
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
    a: alpha,
  }
}

function createBuffer(size) {
  return { width: size, height: size, data: Buffer.alloc(size * size * 4) }
}

function setPixel(buffer, x, y, color) {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
  const offset = (y * buffer.width + x) * 4
  const sourceAlpha = color.a / 255
  const targetAlpha = buffer.data[offset + 3] / 255
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  if (outputAlpha <= 0) return
  buffer.data[offset] = Math.round(
    (color.r * sourceAlpha + buffer.data[offset] * targetAlpha * (1 - sourceAlpha))
      / outputAlpha,
  )
  buffer.data[offset + 1] = Math.round(
    (color.g * sourceAlpha + buffer.data[offset + 1] * targetAlpha * (1 - sourceAlpha))
      / outputAlpha,
  )
  buffer.data[offset + 2] = Math.round(
    (color.b * sourceAlpha + buffer.data[offset + 2] * targetAlpha * (1 - sourceAlpha))
      / outputAlpha,
  )
  buffer.data[offset + 3] = Math.round(outputAlpha * 255)
}

function fillRect(buffer, x, y, width, height, color) {
  const startX = Math.max(0, Math.floor(x))
  const endX = Math.min(buffer.width, Math.ceil(x + width))
  const startY = Math.max(0, Math.floor(y))
  const endY = Math.min(buffer.height, Math.ceil(y + height))
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      setPixel(buffer, column, row, color)
    }
  }
}

function fillDisc(buffer, centerX, centerY, radius, color) {
  const radiusSquared = radius * radius
  for (let y = Math.max(0, Math.floor(centerY - radius)); y < Math.min(buffer.height, Math.ceil(centerY + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - radius)); x < Math.min(buffer.width, Math.ceil(centerX + radius)); x += 1) {
      const dx = x + 0.5 - centerX
      const dy = y + 0.5 - centerY
      if (dx * dx + dy * dy <= radiusSquared) setPixel(buffer, x, y, color)
    }
  }
}

function fillRing(buffer, centerX, centerY, innerRadius, outerRadius, color) {
  const innerSquared = innerRadius * innerRadius
  const outerSquared = outerRadius * outerRadius
  for (let y = Math.max(0, Math.floor(centerY - outerRadius)); y < Math.min(buffer.height, Math.ceil(centerY + outerRadius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - outerRadius)); x < Math.min(buffer.width, Math.ceil(centerX + outerRadius)); x += 1) {
      const dx = x + 0.5 - centerX
      const dy = y + 0.5 - centerY
      const distanceSquared = dx * dx + dy * dy
      if (distanceSquared >= innerSquared && distanceSquared <= outerSquared) {
        setPixel(buffer, x, y, color)
      }
    }
  }
}

function drawLine(buffer, startX, startY, endX, endY, width, color) {
  const distance = Math.hypot(endX - startX, endY - startY)
  const steps = Math.max(1, Math.ceil(distance))
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps
    fillDisc(
      buffer,
      startX + (endX - startX) * progress,
      startY + (endY - startY) * progress,
      width / 2,
      color,
    )
  }
}

function fillGradient(buffer, top, bottom) {
  for (let y = 0; y < buffer.height; y += 1) {
    const progress = y / Math.max(1, buffer.height - 1)
    const color = {
      r: Math.round(top.r + (bottom.r - top.r) * progress),
      g: Math.round(top.g + (bottom.g - top.g) * progress),
      b: Math.round(top.b + (bottom.b - top.b) * progress),
      a: 255,
    }
    fillRect(buffer, 0, y, buffer.width, 1, color)
  }
}

function drawFrame(buffer, color) {
  const outer = Math.max(2, Math.round(buffer.width * 0.025))
  const inner = Math.max(1, Math.round(buffer.width * 0.008))
  fillRect(buffer, 0, 0, buffer.width, outer, rgb('#08090d'))
  fillRect(buffer, 0, buffer.height - outer, buffer.width, outer, rgb('#08090d'))
  fillRect(buffer, 0, 0, outer, buffer.height, rgb('#08090d'))
  fillRect(buffer, buffer.width - outer, 0, outer, buffer.height, rgb('#08090d'))
  fillRect(buffer, outer, outer, buffer.width - outer * 2, inner, color)
  fillRect(buffer, outer, buffer.height - outer - inner, buffer.width - outer * 2, inner, color)
  fillRect(buffer, outer, outer, inner, buffer.height - outer * 2, color)
  fillRect(buffer, buffer.width - outer - inner, outer, inner, buffer.height - outer * 2, color)
}

function drawSkyline(buffer, color) {
  const unit = buffer.width / 32
  const ground = Math.round(buffer.height * 0.87)
  const heights = [5, 9, 7, 12, 6, 10, 8, 14, 7, 11, 5, 9, 13, 8, 10, 6]
  heights.forEach((height, index) => {
    const x = Math.floor(index * unit * 2)
    const top = ground - Math.floor(height * unit)
    fillRect(buffer, x, top, Math.ceil(unit * 1.7), ground - top, color)
  })
  fillRect(buffer, 0, ground, buffer.width, buffer.height - ground, color)
}

function drawSilhouette(buffer, recipe, bounds, primary, secondary) {
  const cellSize = Math.max(
    1,
    Math.floor(Math.min(bounds.width, bounds.height) / CARD_VISUAL_GRID_SIZE),
  )
  const renderedSize = cellSize * CARD_VISUAL_GRID_SIZE
  const offsetX = Math.floor(bounds.x + (bounds.width - renderedSize) / 2)
  const offsetY = Math.floor(bounds.y + (bounds.height - renderedSize) / 2)
  recipe.silhouette.forEach((row, y) => {
    Array.from(row).forEach((symbol, x) => {
      if (symbol === '#' || symbol === '+') {
        fillRect(
          buffer,
          offsetX + x * cellSize,
          offsetY + y * cellSize,
          cellSize,
          cellSize,
          symbol === '#' ? primary : secondary,
        )
      }
    })
  })
}

function drawAbilityCue(buffer, key, color) {
  const size = buffer.width
  const lineWidth = Math.max(2, Math.round(size * 0.008))
  switch (key) {
    case 'Forest':
      drawLine(buffer, size * 0.16, size * 0.9, size * 0.34, size * 0.62, lineWidth, color)
      drawLine(buffer, size * 0.84, size * 0.9, size * 0.67, size * 0.62, lineWidth, color)
      break
    case 'Island':
      for (const radius of [0.13, 0.19, 0.25]) {
        fillRing(buffer, size * 0.68, size * 0.4, size * radius, size * radius + lineWidth, color)
      }
      break
    case 'Mountain':
      drawLine(buffer, size * 0.2, size * 0.7, size * 0.08, size * 0.58, lineWidth * 2, color)
      drawLine(buffer, size * 0.8, size * 0.7, size * 0.92, size * 0.58, lineWidth * 2, color)
      break
    case 'Plains':
      fillRect(buffer, size * 0.49, size * 0.16, lineWidth, size * 0.66, color)
      fillRect(buffer, size * 0.46, size * 0.16, lineWidth, size * 0.66, rgb('#ffffff', 80))
      break
    case 'Swamp':
      for (const [x, y, radius] of [[0.2, 0.32, 0.025], [0.77, 0.25, 0.035], [0.84, 0.52, 0.02]]) {
        fillDisc(buffer, size * x, size * y, size * radius, color)
        fillRing(buffer, size * x, size * y, size * radius * 1.8, size * radius * 2.1, rgb('#ffffff', 70))
      }
      break
    default:
      break
  }
}

function renderClassic(recipe, size) {
  const colors = COLOR_ROLES[recipe.serializedKey]
  const buffer = createBuffer(size)
  fillGradient(buffer, rgb(colors.background), rgb(colors.dark))
  drawSilhouette(
    buffer,
    recipe,
    { x: size * 0.12, y: size * 0.12, width: size * 0.76, height: size * 0.76 },
    rgb(colors.primary),
    rgb(colors.secondary),
  )
  drawFrame(buffer, rgb(colors.secondary))
  return buffer
}

function renderHdFallback(recipe, size) {
  const colors = COLOR_ROLES[recipe.serializedKey]
  const buffer = createBuffer(size)
  fillGradient(buffer, rgb(colors.background), rgb(colors.dark))
  fillDisc(buffer, size * 0.5, size * 0.43, size * 0.34, rgb(colors.secondary, 45))
  drawSkyline(buffer, rgb(colors.dark, 235))
  drawAbilityCue(buffer, recipe.serializedKey, rgb(colors.secondary, 150))
  drawSilhouette(
    buffer,
    recipe,
    { x: size * 0.13, y: size * 0.08, width: size * 0.74, height: size * 0.76 },
    rgb(colors.primary),
    rgb(colors.secondary),
  )
  drawFrame(buffer, rgb(colors.secondary))
  return buffer
}

function renderMonochrome(recipe, size) {
  const buffer = createBuffer(size)
  fillGradient(buffer, rgb('#3b3b42'), rgb('#08090d'))
  fillDisc(buffer, size * 0.5, size * 0.42, size * 0.32, rgb('#ffffff', 28))
  drawSkyline(buffer, rgb('#050506', 235))
  drawAbilityCue(buffer, recipe.serializedKey, rgb('#c8c8cf', 135))
  drawSilhouette(
    buffer,
    recipe,
    { x: size * 0.13, y: size * 0.08, width: size * 0.74, height: size * 0.76 },
    rgb('#eeeeF2'),
    rgb('#9f9fa8'),
  )
  drawFrame(buffer, rgb('#b8b8c0'))
  return buffer
}

const RENDERERS = Object.freeze({
  classic: renderClassic,
  'hd-fallback': renderHdFallback,
  monochrome: renderMonochrome,
})

export function generateCardArt({
  outputRoot = DEFAULT_OUTPUT_ROOT,
  size = DEFAULT_SIZE,
} = {}) {
  if (!Number.isSafeInteger(size) || size < MINIMUM_SIZE || size > MAXIMUM_SIZE) {
    throw new Error(`size must be an integer from ${MINIMUM_SIZE} to ${MAXIMUM_SIZE}`)
  }
  const written = []
  for (const style of GENERATED_STYLES) {
    const directory = resolve(outputRoot, style)
    mkdirSync(directory, { recursive: true })
    for (const recipe of ORDERED_CARD_VISUAL_RECIPES) {
      const buffer = RENDERERS[style](recipe, size)
      const outputPath = resolve(directory, `${recipe.assetSlug}.png`)
      writeFileSync(outputPath, encodePng(buffer.width, buffer.height, buffer.data))
      written.push(outputPath)
    }
  }
  return written
}

function parseArguments(argv) {
  let outputRoot = DEFAULT_OUTPUT_ROOT
  let size = DEFAULT_SIZE
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      console.log([
        'Usage: node scripts/generate-card-art.mjs [--output <directory>] [--size <pixels>]',
        '',
        'Generates deterministic Classic, HD-fallback, and Monochrome creature art.',
      ].join('\n'))
      return null
    }
    if (argument === '--output' || argument === '--size') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      if (argument === '--output') outputRoot = resolve(value)
      else size = Number(value)
      index += 1
      continue
    }
    if (argument.startsWith('--output=')) {
      outputRoot = resolve(argument.slice('--output='.length))
      continue
    }
    if (argument.startsWith('--size=')) {
      size = Number(argument.slice('--size='.length))
      continue
    }
    throw new Error(`unknown option '${argument}'`)
  }
  return { outputRoot, size }
}

function isMainModule() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options) {
      const written = generateCardArt(options)
      for (const path of written) console.log(`wrote ${path}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
