import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const THEMES_PATH = resolve(ROOT, 'tools', 'board-backgrounds', 'themes.json')
const OUTPUT_ROOT = resolve(ROOT, 'public', 'boards')
const OUTPUT_VARIANTS = [
  ['hd', 1920, 1080],
  ['balanced', 1280, 720],
  ['low', 960, 540],
  ['fallback', 640, 360],
]

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function mix(a, b, t) {
  return a + (b - a) * t
}

function rgbFromList(values) {
  return { r: values[0], g: values[1], b: values[2] }
}

function blendColor(base, overlay, amount) {
  return {
    r: Math.round(mix(base.r, overlay.r, amount)),
    g: Math.round(mix(base.g, overlay.g, amount)),
    b: Math.round(mix(base.b, overlay.b, amount)),
  }
}

function hash2d(seed, x, y) {
  const value = Math.sin((x + 1.7) * 127.1 + (y + 3.11) * 311.7 + seed * 17.17) * 43758.5453123
  return value - Math.floor(value)
}

function createBuffer(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) }
}

function setPixel(buffer, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
  const index = (y * buffer.width + x) * 4
  const srcA = alpha / 255
  const dstA = buffer.data[index + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) {
    buffer.data[index] = 0
    buffer.data[index + 1] = 0
    buffer.data[index + 2] = 0
    buffer.data[index + 3] = 0
    return
  }
  const sr = color.r
  const sg = color.g
  const sb = color.b
  const dr = buffer.data[index]
  const dg = buffer.data[index + 1]
  const db = buffer.data[index + 2]
  buffer.data[index] = Math.round((sr * srcA + dr * dstA * (1 - srcA)) / outA)
  buffer.data[index + 1] = Math.round((sg * srcA + dg * dstA * (1 - srcA)) / outA)
  buffer.data[index + 2] = Math.round((sb * srcA + db * dstA * (1 - srcA)) / outA)
  buffer.data[index + 3] = Math.round(outA * 255)
}

function fillRect(buffer, x0, y0, width, height, color, alpha = 255) {
  for (let y = Math.max(0, y0); y < Math.min(buffer.height, y0 + height); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(buffer.width, x0 + width); x += 1) {
      setPixel(buffer, x, y, color, alpha)
    }
  }
}

function drawVignette(buffer, radius, color, strength) {
  const centerX = buffer.width / 2
  const centerY = buffer.height / 2
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const dx = x - centerX
      const dy = y - centerY
      const dist = Math.sqrt((dx * dx) + (dy * dy))
      const maxDist = Math.sqrt((centerX * centerX) + (centerY * centerY))
      const fade = clamp(1 - dist / (maxDist * radius), 0, 1)
      const alpha = Math.round((1 - fade) * 255 * strength)
      if (alpha <= 0) continue
      const index = (y * buffer.width + x) * 4
      const base = {
        r: buffer.data[index],
        g: buffer.data[index + 1],
        b: buffer.data[index + 2],
      }
      const mixed = blendColor(base, color, alpha / 255)
      buffer.data[index] = mixed.r
      buffer.data[index + 1] = mixed.g
      buffer.data[index + 2] = mixed.b
    }
  }
}

function drawDust(buffer, theme, seed) {
  const count = Math.max(120, Math.min(2200, Math.round(buffer.width * buffer.height / 18)))
  for (let i = 0; i < count; i += 1) {
    const x = hash2d(seed + i, i * 1.7, 13.2) * buffer.width
    const y = hash2d(seed + i * 3, 27.1, i * 2.1) * buffer.height
    const radius = 1 + hash2d(seed + i * 6, 31.3, 41.7) * 2.2
    const brightness = 10 + hash2d(seed + i * 9, 9.8, 5.4) * 55
    const color = {
      r: theme.dust[0] + brightness * 0.2,
      g: theme.dust[1] + brightness * 0.15,
      b: theme.dust[2] + brightness * 0.1,
    }
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue
        setPixel(buffer, Math.round(x + dx), Math.round(y + dy), color, 28)
      }
    }
  }
}

function drawPattern(buffer, theme, seed) {
  const tile = theme.tileSize
  const plankCount = theme.planks
  const grainStrength = clamp(Number.isFinite(theme.grain) ? theme.grain : 0.18, 0, 1)
  const highlight = rgbFromList(theme.highlight)
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const nx = x / (tile * 1.2)
      const ny = y / (tile * 1.2)
      const plankBand = Math.floor((x / buffer.width) * plankCount + (y / buffer.height) * 0.75)
      const grain = hash2d(seed + plankBand, Math.floor(nx * 33), Math.floor(ny * 22))
      const streak = Math.sin((x + seed * 17) / 18 + (y + seed * 9) / 12) * 0.5 + 0.5
      const woodMix = clamp((grain * (0.45 + grainStrength) + streak * 0.2 + (plankBand % 2) * 0.1), 0, 1)
      const dark = { r: theme.woodDark[0], g: theme.woodDark[1], b: theme.woodDark[2] }
      const light = { r: theme.woodLight[0], g: theme.woodLight[1], b: theme.woodLight[2] }
      const base = { r: theme.woodBase[0], g: theme.woodBase[1], b: theme.woodBase[2] }
      const selected = blendColor(base, woodMix > 0.5 ? light : dark, 0.6)
      const warm = blendColor(selected, highlight, 0.12 + streak * 0.08)
      setPixel(buffer, x, y, warm)
    }
  }

  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const stripe = Math.sin((x + y * 0.6) / 14 + seed) * 0.5 + 0.5
      const v = hash2d(seed + 7, Math.floor(x / 12), Math.floor(y / 12))
      if (stripe > 0.7 && v > 0.35) {
        const index = (y * buffer.width + x) * 4
        const current = { r: buffer.data[index], g: buffer.data[index + 1], b: buffer.data[index + 2] }
        const shaded = blendColor(current, { r: theme.shadow[0], g: theme.shadow[1], b: theme.shadow[2] }, 0.08)
        buffer.data[index] = shaded.r
        buffer.data[index + 1] = shaded.g
        buffer.data[index + 2] = shaded.b
      }
    }
  }
}

function drawFeltCenter(buffer, theme, seed) {
  const cx = buffer.width * 0.5
  const cy = buffer.height * 0.5
  const rx = buffer.width * 0.58
  const ry = buffer.height * 0.68

  for (let y = 0; y < buffer.height; y += 1) {
    const dy = (y - cy) / ry
    for (let x = 0; x < buffer.width; x += 1) {
      const dx = (x - cx) / rx
      const dist = dx * dx + dy * dy
      if (dist > 1.15) continue
      const falloff = clamp(1 - dist, 0, 1)
      const colorBase = {
        r: theme.feltBase[0],
        g: theme.feltBase[1],
        b: theme.feltBase[2],
      }
      const colorLight = {
        r: theme.feltLight[0],
        g: theme.feltLight[1],
        b: theme.feltLight[2],
      }
      const weave = hash2d(seed + 91, Math.floor(x / 22), Math.floor(y / 22))
      const stripe = Math.sin((x + seed * 9) * 0.18) * 0.5 + 0.5
      const blend = clamp(0.35 + weave * 0.35 + stripe * 0.2 + falloff * 0.2, 0, 1)
      const chosen = blendColor(colorBase, colorLight, blend)
      const index = (y * buffer.width + x) * 4
      const current = { r: buffer.data[index], g: buffer.data[index + 1], b: buffer.data[index + 2] }
      const composite = blendColor(current, chosen, 0.72 * falloff + 0.14)
      buffer.data[index] = composite.r
      buffer.data[index + 1] = composite.g
      buffer.data[index + 2] = composite.b
    }
  }
}

function renderBackground(themeName, width, height) {
  const theme = JSON.parse(readFileSync(THEMES_PATH, 'utf8'))[themeName]
  const buffer = createBuffer(width, height)
  const seed = themeName.length * 13.37 + width * 0.31 + height * 0.17

  fillRect(buffer, 0, 0, width, height, rgbFromList(theme.woodDark))
  drawPattern(buffer, theme, seed)
  drawFeltCenter(buffer, theme, seed)
  drawDust(buffer, theme, seed)
  drawVignette(buffer, theme.vignette, rgbFromList(theme.shadow), 0.46)

  const rgba = Buffer.from(buffer.data)
  return encodePng(width, height, rgba)
}

function ensureOutputFolder(themeName) {
  mkdirSync(resolve(OUTPUT_ROOT, themeName), { recursive: true })
}

function writeVariant(themeName, name, width, height) {
  ensureOutputFolder(themeName)
  const png = renderBackground(themeName, width, height)
  writeFileSync(resolve(OUTPUT_ROOT, themeName, `background-${name}.png`), png)
}

function main() {
  const themes = JSON.parse(readFileSync(THEMES_PATH, 'utf8'))
  for (const themeName of Object.keys(themes)) {
    for (const [variantName, width, height] of OUTPUT_VARIANTS) {
      writeVariant(themeName, variantName, width, height)
    }
  }
  console.log(`Generated ${Object.keys(themes).length} theme presets with ${OUTPUT_VARIANTS.length} variants each.`)
}

main()
