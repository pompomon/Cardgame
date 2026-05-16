// Deterministic generator for the HD card-art assets shipped under
// public/cards/hd/.
//
// Run with:
//   npm run generate:card-art
//
// Implementation notes:
// - Uses only Node stdlib (`node:zlib`, `node:fs`, `node:crypto`,
//   `node:path`, `node:url`) so it can run in CI without extra deps.
// - Emits 1024x1024 8-bit RGBA PNGs. The Phaser renderer scales them down
//   via `setDisplaySize`, so 1024 is comfortably hi-DPI-friendly for any
//   in-game card slot.
// - The result is fully deterministic: re-running on the same checkout
//   produces byte-identical PNGs.
//
// If the visual style/recipe changes here, regenerate and commit the new
// PNGs alongside the change.

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = resolve(HERE, '..', 'public', 'cards', 'hd')

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit truecolor + alpha).
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
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

// ---------------------------------------------------------------------------
// Pixel buffer + drawing helpers.
// ---------------------------------------------------------------------------

function createBuffer(width, height) {
  const data = Buffer.alloc(width * height * 4)
  return { width, height, data }
}

function setPixel(buf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return
  const i = (y * buf.width + x) * 4
  const dstA = buf.data[i + 3] / 255
  const srcA = a / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) {
    buf.data[i] = 0
    buf.data[i + 1] = 0
    buf.data[i + 2] = 0
    buf.data[i + 3] = 0
    return
  }
  buf.data[i] = Math.round((r * srcA + buf.data[i] * dstA * (1 - srcA)) / outA)
  buf.data[i + 1] = Math.round((g * srcA + buf.data[i + 1] * dstA * (1 - srcA)) / outA)
  buf.data[i + 2] = Math.round((b * srcA + buf.data[i + 2] * dstA * (1 - srcA)) / outA)
  buf.data[i + 3] = Math.round(outA * 255)
}

function fillRect(buf, x0, y0, w, h, color) {
  const x1 = Math.min(buf.width, x0 + w)
  const y1 = Math.min(buf.height, y0 + h)
  const xs = Math.max(0, x0)
  const ys = Math.max(0, y0)
  for (let y = ys; y < y1; y += 1) {
    for (let x = xs; x < x1; x += 1) {
      setPixel(buf, x, y, color.r, color.g, color.b, color.a ?? 255)
    }
  }
}

function fillBackgroundGradient(buf, top, bottom) {
  for (let y = 0; y < buf.height; y += 1) {
    const t = y / (buf.height - 1)
    const r = Math.round(top.r + (bottom.r - top.r) * t)
    const g = Math.round(top.g + (bottom.g - top.g) * t)
    const b = Math.round(top.b + (bottom.b - top.b) * t)
    for (let x = 0; x < buf.width; x += 1) {
      const i = (y * buf.width + x) * 4
      buf.data[i] = r
      buf.data[i + 1] = g
      buf.data[i + 2] = b
      buf.data[i + 3] = 255
    }
  }
}

function addRadialGlow(buf, cx, cy, radius, color) {
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(buf.width, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(buf.height, Math.ceil(cy + radius))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dx = x - cx
      const dy = y - cy
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const t = 1 - d2 / r2
      const alpha = Math.round((color.a ?? 255) * t * t)
      if (alpha <= 0) continue
      setPixel(buf, x, y, color.r, color.g, color.b, alpha)
    }
  }
}

function fillDisc(buf, cx, cy, radius, color) {
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius - 1))
  const x1 = Math.min(buf.width, Math.ceil(cx + radius + 1))
  const y0 = Math.max(0, Math.floor(cy - radius - 1))
  const y1 = Math.min(buf.height, Math.ceil(cy + radius + 1))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const d = Math.sqrt(d2)
      const feather = Math.max(0, Math.min(1, radius - d))
      const alpha = Math.round((color.a ?? 255) * feather)
      if (alpha <= 0) continue
      setPixel(buf, x, y, color.r, color.g, color.b, alpha)
    }
  }
}

function fillRing(buf, cx, cy, inner, outer, color) {
  const out2 = outer * outer
  const in2 = inner * inner
  const x0 = Math.max(0, Math.floor(cx - outer - 1))
  const x1 = Math.min(buf.width, Math.ceil(cx + outer + 1))
  const y0 = Math.max(0, Math.floor(cy - outer - 1))
  const y1 = Math.min(buf.height, Math.ceil(cy + outer + 1))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d2 = dx * dx + dy * dy
      if (d2 > out2 || d2 < in2) continue
      const d = Math.sqrt(d2)
      const feather = Math.max(0, Math.min(1, Math.min(outer - d, d - inner)))
      const alpha = Math.round((color.a ?? 255) * feather)
      if (alpha <= 0) continue
      setPixel(buf, x, y, color.r, color.g, color.b, alpha)
    }
  }
}

function fillTriangle(buf, ax, ay, bx, by, cx, cy, color) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(buf.width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(buf.height - 1, Math.ceil(Math.max(ay, by, cy)))
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (denom === 0) return
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
      const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
      const w3 = 1 - w1 - w2
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        setPixel(buf, x, y, color.r, color.g, color.b, color.a ?? 255)
      }
    }
  }
}

function drawLine(buf, x0, y0, x1, y1, width, color) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len <= 0) return
  const steps = Math.ceil(len)
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const cx = x0 + dx * t
    const cy = y0 + dy * t
    fillDisc(buf, cx, cy, width / 2, color)
  }
}

function fillPolygon(buf, points, color) {
  if (points.length < 3) return
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))))
  const maxY = Math.min(buf.height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))))
  for (let y = minY; y <= maxY; y += 1) {
    const xs = []
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i]
      const [bx, by] = points[(i + 1) % points.length]
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        const t = (y - ay) / (by - ay)
        xs.push(ax + (bx - ax) * t)
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xs0 = Math.max(0, Math.floor(xs[k]))
      const xs1 = Math.min(buf.width - 1, Math.ceil(xs[k + 1]))
      for (let x = xs0; x <= xs1; x += 1) {
        setPixel(buf, x, y, color.r, color.g, color.b, color.a ?? 255)
      }
    }
  }
}

// Deterministic seeded PRNG (mulberry32) so re-runs are byte-identical.
function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rgb(r, g, b, a = 255) {
  return { r, g, b, a }
}

function hexToRgb(hex, a = 255) {
  const m = hex.replace('#', '')
  return rgb(
    parseInt(m.substring(0, 2), 16),
    parseInt(m.substring(2, 4), 16),
    parseInt(m.substring(4, 6), 16),
    a,
  )
}

// ---------------------------------------------------------------------------
// Frame: ornate beveled border drawn around every card.
// ---------------------------------------------------------------------------

function drawFrame(buf, accent) {
  const w = buf.width
  const h = buf.height
  fillRect(buf, 0, 0, w, 28, rgb(8, 8, 12))
  fillRect(buf, 0, h - 28, w, 28, rgb(8, 8, 12))
  fillRect(buf, 0, 0, 28, h, rgb(8, 8, 12))
  fillRect(buf, w - 28, 0, 28, h, rgb(8, 8, 12))

  fillRect(buf, 28, 28, w - 56, 12, accent)
  fillRect(buf, 28, h - 40, w - 56, 12, accent)
  fillRect(buf, 28, 28, 12, h - 56, accent)
  fillRect(buf, w - 40, 28, 12, h - 56, accent)

  const hi = rgb(255, 255, 255, 64)
  fillRect(buf, 40, 40, w - 80, 2, hi)
  fillRect(buf, 40, 40, 2, h - 80, hi)

  const sh = rgb(0, 0, 0, 96)
  fillRect(buf, 40, h - 42, w - 80, 2, sh)
  fillRect(buf, w - 42, 40, 2, h - 80, sh)

  for (const [cx, cy] of [[44, 44], [w - 44, 44], [44, h - 44], [w - 44, h - 44]]) {
    fillDisc(buf, cx, cy, 14, rgb(8, 8, 12))
    fillDisc(buf, cx, cy, 10, accent)
    fillDisc(buf, cx - 3, cy - 3, 3, rgb(255, 255, 255, 192))
  }
}

// ---------------------------------------------------------------------------
// Per-land scene compositions.
// ---------------------------------------------------------------------------

function paintForest(buf) {
  fillBackgroundGradient(buf, hexToRgb('#0a3a1f'), hexToRgb('#03110a'))
  addRadialGlow(buf, 512, 380, 260, hexToRgb('#5ed59a', 110))
  fillDisc(buf, 512, 360, 60, hexToRgb('#d9ffe8', 220))

  fillPolygon(
    buf,
    [
      [0, 720], [220, 600], [430, 660], [640, 580],
      [880, 660], [1024, 620], [1024, 1024], [0, 1024],
    ],
    hexToRgb('#0d3f25'),
  )
  fillPolygon(
    buf,
    [
      [0, 800], [180, 720], [410, 760], [620, 700],
      [840, 760], [1024, 740], [1024, 1024], [0, 1024],
    ],
    hexToRgb('#0a2f1c'),
  )

  function drawPine(cx, baseY, height, color) {
    const trunkW = Math.max(4, Math.round(height * 0.05))
    fillRect(buf, Math.round(cx - trunkW / 2), Math.round(baseY - height * 0.1), trunkW, Math.round(height * 0.18), hexToRgb('#1a0e06'))
    const layers = 5
    for (let i = 0; i < layers; i += 1) {
      const t = i / layers
      const yTop = baseY - height + t * height * 0.7
      const yBot = yTop + height * 0.32
      const wHalf = (height * 0.38) * (0.45 + t * 0.55)
      fillTriangle(buf, cx, yTop, cx - wHalf, yBot, cx + wHalf, yBot, color)
    }
  }
  const bgColor = hexToRgb('#1e6b40')
  for (const [x, y, h] of [
    [80, 760, 220], [180, 770, 180], [300, 790, 240], [410, 780, 200],
    [560, 800, 220], [700, 770, 240], [820, 790, 200], [930, 780, 230],
  ]) {
    drawPine(x, y, h, bgColor)
  }
  const fgColor = hexToRgb('#0c3a1f')
  drawPine(260, 970, 540, fgColor)
  drawPine(760, 980, 560, fgColor)
  drawPine(512, 1024, 700, hexToRgb('#072517'))

  fillRect(buf, 0, 960, 1024, 64, hexToRgb('#03100a'))
}

function paintIsland(buf) {
  fillBackgroundGradient(buf, hexToRgb('#0b1f4a'), hexToRgb('#04122e'))
  addRadialGlow(buf, 720, 280, 260, hexToRgb('#a8dcff', 110))
  fillDisc(buf, 720, 280, 100, hexToRgb('#f0f7ff', 240))
  fillDisc(buf, 690, 250, 16, hexToRgb('#c8dbf2', 200))
  fillDisc(buf, 740, 320, 10, hexToRgb('#c8dbf2', 200))

  const rand = mulberry32(42)
  for (let i = 0; i < 80; i += 1) {
    const x = rand() * 1024
    const y = rand() * 500
    const a = 120 + Math.floor(rand() * 130)
    fillDisc(buf, x, y, 1.5 + rand() * 1.5, rgb(255, 255, 255, a))
  }

  fillRect(buf, 0, 560, 1024, 4, hexToRgb('#7fc4ff', 160))

  fillPolygon(
    buf,
    [
      [120, 600], [260, 540], [420, 580], [560, 540], [700, 600],
    ],
    hexToRgb('#0a1b3a'),
  )

  for (let i = 0; i < 18; i += 1) {
    const y = 580 + i * 22 + (i % 2) * 4
    const alpha = 70 + i * 6
    for (let segX = 0; segX < 1024; segX += 80) {
      const segW = 40 + (i % 3) * 8
      fillRect(buf, segX + (i % 2) * 24, y, segW, 4, hexToRgb('#5fb6ff', Math.min(220, alpha)))
    }
  }
  fillRect(buf, 0, 940, 1024, 84, hexToRgb('#03102a'))
  for (let i = 0; i < 12; i += 1) {
    const y = 600 + i * 28
    const w = 220 - i * 14
    fillRect(buf, 720 - w / 2, y, w, 6, hexToRgb('#e7f4ff', 110 - i * 6))
  }
}

function paintMountain(buf) {
  fillBackgroundGradient(buf, hexToRgb('#1a0a08'), hexToRgb('#4a1a10'))
  addRadialGlow(buf, 512, 460, 360, hexToRgb('#ffb27a', 160))
  fillDisc(buf, 512, 460, 80, hexToRgb('#ffe3c0', 240))

  fillPolygon(
    buf,
    [
      [-20, 700], [120, 580], [260, 640], [400, 540],
      [520, 600], [640, 520], [780, 600], [900, 560],
      [1044, 660], [1044, 1024], [-20, 1024],
    ],
    hexToRgb('#3a1108'),
  )

  fillPolygon(
    buf,
    [
      [-20, 820], [80, 700], [240, 760], [380, 640],
      [540, 720], [680, 620], [840, 720], [1044, 700],
      [1044, 1024], [-20, 1024],
    ],
    hexToRgb('#2a0a05'),
  )

  const peakColor = hexToRgb('#1a0604')
  fillPolygon(
    buf,
    [
      [-20, 1024], [-20, 880], [120, 800], [240, 860],
      [360, 720], [460, 800], [560, 640], [680, 760],
      [780, 700], [900, 820], [1044, 780], [1044, 1024],
    ],
    peakColor,
  )
  fillPolygon(buf, [[560, 640], [510, 720], [610, 720]], hexToRgb('#fff5e8'))
  fillPolygon(buf, [[360, 720], [320, 780], [400, 780]], hexToRgb('#fff5e8'))
  fillPolygon(buf, [[680, 760], [650, 800], [710, 800]], hexToRgb('#fff5e8'))

  const lava = hexToRgb('#ff8b62', 220)
  drawLine(buf, 320, 950, 380, 870, 5, lava)
  drawLine(buf, 380, 870, 360, 800, 4, lava)
  drawLine(buf, 600, 960, 660, 880, 5, lava)
  drawLine(buf, 660, 880, 700, 820, 4, lava)

  const rand = mulberry32(7)
  for (let i = 0; i < 60; i += 1) {
    const x = rand() * 1024
    const y = 400 + rand() * 500
    fillDisc(buf, x, y, 2 + rand() * 2.5, hexToRgb('#ffa766', 180 + Math.floor(rand() * 60)))
  }
}

function paintPlains(buf) {
  fillBackgroundGradient(buf, hexToRgb('#5a4a16'), hexToRgb('#1a160a'))
  addRadialGlow(buf, 512, 360, 360, hexToRgb('#ffe89a', 180))
  fillDisc(buf, 512, 360, 110, hexToRgb('#fff7d6', 240))

  fillPolygon(
    buf,
    [
      [0, 660], [220, 600], [460, 640], [700, 580],
      [1024, 640], [1024, 1024], [0, 1024],
    ],
    hexToRgb('#6e5a1f'),
  )
  fillPolygon(
    buf,
    [
      [0, 760], [240, 700], [520, 740], [780, 680],
      [1024, 740], [1024, 1024], [0, 1024],
    ],
    hexToRgb('#473a14'),
  )

  fillPolygon(
    buf,
    [
      [0, 880], [260, 820], [560, 860], [820, 800],
      [1024, 840], [1024, 1024], [0, 1024],
    ],
    hexToRgb('#2f2810'),
  )

  fillPolygon(buf, [[260, 600], [340, 520], [420, 600]], hexToRgb('#3a2f10', 200))
  fillPolygon(buf, [[600, 600], [690, 500], [780, 600]], hexToRgb('#3a2f10', 200))

  const rand = mulberry32(11)
  for (let i = 0; i < 220; i += 1) {
    const x = rand() * 1024
    const y = 880 + rand() * 140
    const h = 14 + rand() * 18
    drawLine(buf, x, y, x + (rand() - 0.5) * 6, y - h, 1.4, hexToRgb('#f4d35e', 200))
  }

  fillRect(buf, 200, 760, 8, 120, hexToRgb('#0e0a04'))
  fillDisc(buf, 204, 750, 46, hexToRgb('#1f1a0b'))
}

function paintSwamp(buf) {
  // Near-black sky with a sickly bruise-purple cast fading into pitch-dark
  // marsh. No bright moon — just an oppressive void.
  fillBackgroundGradient(buf, hexToRgb('#0b0612'), hexToRgb('#020106'))

  // Distant, sickly green miasma glow on the horizon (low and ominous,
  // not warm/inviting).
  addRadialGlow(buf, 512, 720, 520, hexToRgb('#1f3a25', 140))
  addRadialGlow(buf, 200, 760, 280, hexToRgb('#2a1f3a', 110))
  addRadialGlow(buf, 820, 740, 260, hexToRgb('#2a1f3a', 110))

  // Crescent moon — bone-white, partially eclipsed by a dark cloud-bite so
  // it reads as a sliver rather than a full disc.
  const moonCx = 760
  const moonCy = 260
  fillDisc(buf, moonCx, moonCy, 70, hexToRgb('#c9c4b8', 200))
  // Carve a bite out of the moon to form the crescent.
  fillDisc(buf, moonCx + 28, moonCy - 10, 64, hexToRgb('#020106', 255))
  // Faint diffuse halo around the moon (not warm).
  addRadialGlow(buf, moonCx, moonCy, 180, hexToRgb('#9aa3b0', 60))

  // Drifting clouds across the moon.
  fillRect(buf, 640, 250, 220, 10, hexToRgb('#050309', 220))
  fillRect(buf, 600, 280, 320, 6, hexToRgb('#050309', 200))
  fillRect(buf, 700, 310, 260, 8, hexToRgb('#050309', 210))

  // A few distant bats — small angular silhouettes.
  function drawBat(cx, cy, scale) {
    const s = scale
    fillPolygon(
      buf,
      [
        [cx, cy],
        [cx - 6 * s, cy - 3 * s],
        [cx - 14 * s, cy - 6 * s],
        [cx - 10 * s, cy], [cx - 14 * s, cy + 3 * s],
        [cx - 6 * s, cy + 1 * s],
        [cx, cy + 3 * s],
        [cx + 6 * s, cy + 1 * s],
        [cx + 14 * s, cy + 3 * s], [cx + 10 * s, cy],
        [cx + 14 * s, cy - 6 * s],
        [cx + 6 * s, cy - 3 * s],
      ],
      hexToRgb('#020106'),
    )
  }
  drawBat(560, 180, 1.6)
  drawBat(440, 220, 1.0)
  drawBat(360, 150, 1.2)
  drawBat(880, 200, 0.8)
  drawBat(180, 280, 0.9)

  // Distant tangled silhouette band — pure black, oppressive.
  fillRect(buf, 0, 620, 1024, 220, hexToRgb('#020106', 230))
  // Jagged dead-treeline silhouette across the band.
  const treelineRand = mulberry32(123)
  for (let x = 0; x < 1024; x += 22) {
    const h = 18 + treelineRand() * 60
    fillPolygon(
      buf,
      [
        [x, 640],
        [x + 11, 640 - h],
        [x + 22, 640],
      ],
      hexToRgb('#020106'),
    )
  }

  // Heavy low-lying fog layers (cool sickly green-grey).
  for (let i = 0; i < 10; i += 1) {
    const y = 680 + i * 28
    const alpha = 50 + i * 8
    fillRect(buf, 0, y, 1024, 6, hexToRgb('#3a4a3a', alpha))
    fillRect(buf, 0, y + 10, 1024, 2, hexToRgb('#2a3a2a', Math.floor(alpha * 0.6)))
  }
  // Patchy fog blobs.
  const fogRand = mulberry32(31)
  for (let i = 0; i < 18; i += 1) {
    const cx = fogRand() * 1024
    const cy = 700 + fogRand() * 220
    const r = 50 + fogRand() * 90
    addRadialGlow(buf, cx, cy, r, hexToRgb('#4a5a4a', 70))
  }

  // Gnarled, skeletal dead trees — leaning, with reaching, claw-like branches.
  function drawDeadTree(cx, baseY, height, lean, color) {
    const topX = cx + lean
    const topY = baseY - height
    // Main trunk, slightly thicker at base.
    drawLine(buf, cx, baseY, cx + lean * 0.4, baseY - height * 0.45, 11, color)
    drawLine(buf, cx + lean * 0.4, baseY - height * 0.45, topX, topY, 8, color)

    // Left branches (twisted, descending then reaching up like claws).
    drawLine(buf, cx - 2, baseY - height * 0.5, cx - 70, baseY - height * 0.62, 6, color)
    drawLine(buf, cx - 70, baseY - height * 0.62, cx - 130, baseY - height * 0.55, 5, color)
    drawLine(buf, cx - 130, baseY - height * 0.55, cx - 150, baseY - height * 0.72, 4, color)
    drawLine(buf, cx - 130, baseY - height * 0.55, cx - 170, baseY - height * 0.46, 3, color)
    drawLine(buf, cx - 150, baseY - height * 0.72, cx - 160, baseY - height * 0.86, 3, color)

    // Right branches.
    drawLine(buf, cx + 2, baseY - height * 0.62, cx + 90, baseY - height * 0.5, 6, color)
    drawLine(buf, cx + 90, baseY - height * 0.5, cx + 150, baseY - height * 0.58, 5, color)
    drawLine(buf, cx + 150, baseY - height * 0.58, cx + 180, baseY - height * 0.74, 4, color)
    drawLine(buf, cx + 150, baseY - height * 0.58, cx + 200, baseY - height * 0.46, 3, color)
    drawLine(buf, cx + 180, baseY - height * 0.74, cx + 196, baseY - height * 0.9, 3, color)

    // Upper claw fingers near the top.
    drawLine(buf, topX, topY + 4, topX - 26, topY - 30, 4, color)
    drawLine(buf, topX - 26, topY - 30, topX - 36, topY - 56, 3, color)
    drawLine(buf, topX, topY + 4, topX + 22, topY - 36, 4, color)
    drawLine(buf, topX + 22, topY - 36, topX + 30, topY - 60, 3, color)
    drawLine(buf, topX, topY + 4, topX + 2, topY - 50, 3, color)
  }
  const treeColor = hexToRgb('#020106')
  drawDeadTree(180, 940, 600, -20, treeColor)
  drawDeadTree(860, 950, 580, 24, treeColor)
  drawDeadTree(520, 980, 700, -8, hexToRgb('#010104'))
  // A short, hunched stump-tree in mid-ground.
  drawDeadTree(380, 960, 320, 30, treeColor)
  drawDeadTree(700, 965, 300, -28, treeColor)

  // A leaning tombstone silhouette on the left bank.
  fillPolygon(
    buf,
    [
      [80, 940],
      [82, 880],
      [96, 858],
      [126, 854],
      [142, 872],
      [144, 940],
    ],
    hexToRgb('#1a1620'),
  )
  // Cross etched on the tombstone (slightly lighter for readability).
  fillRect(buf, 108, 882, 6, 36, hexToRgb('#2a2630'))
  fillRect(buf, 100, 894, 22, 6, hexToRgb('#2a2630'))

  // Foreground swamp water — almost black, with faint cold reflections.
  fillRect(buf, 0, 920, 1024, 104, hexToRgb('#03020a'))
  // Subtle reflective ripples in cold green-grey, not vibrant purple.
  for (let i = 0; i < 16; i += 1) {
    const y = 944 + i * 7
    fillRect(buf, 60 + (i * 41) % 700, y, 40 + (i * 19) % 70, 2, hexToRgb('#3a4a3a', 70))
  }
  // Moon's pale broken reflection on the water.
  for (let i = 0; i < 8; i += 1) {
    const y = 940 + i * 10
    const w = 90 - i * 8
    fillRect(buf, moonCx - w / 2, y, w, 3, hexToRgb('#9aa3b0', 70 - i * 6))
  }

  // Sparse, dim, sickly-green will-o-the-wisps drifting low over the water
  // (fewer + dimmer than the previous lavender fireflies).
  const wispRand = mulberry32(99)
  for (let i = 0; i < 14; i += 1) {
    const x = wispRand() * 1024
    const y = 720 + wispRand() * 220
    const a = 110 + Math.floor(wispRand() * 60)
    addRadialGlow(buf, x, y, 22, hexToRgb('#6fa56b', Math.floor(a / 3)))
    fillDisc(buf, x, y, 2 + wispRand() * 1.5, hexToRgb('#b8d8a8', a))
  }

  // A pair of glowing eyes peering out from the deep treeline.
  fillDisc(buf, 612, 760, 3.5, hexToRgb('#c9342a', 230))
  fillDisc(buf, 624, 760, 3.5, hexToRgb('#c9342a', 230))
  addRadialGlow(buf, 618, 760, 18, hexToRgb('#c9342a', 60))
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

const LAND_RECIPES = {
  Forest: { paint: paintForest, accent: hexToRgb('#5ed59a') },
  Island: { paint: paintIsland, accent: hexToRgb('#5fb6ff') },
  Mountain: { paint: paintMountain, accent: hexToRgb('#ff8b62') },
  Plains: { paint: paintPlains, accent: hexToRgb('#f4d35e') },
  Swamp: { paint: paintSwamp, accent: hexToRgb('#b075d8') },
}

function renderCard(land) {
  const recipe = LAND_RECIPES[land]
  const buf = createBuffer(SIZE, SIZE)
  recipe.paint(buf)
  drawFrame(buf, recipe.accent)
  return buf
}

function main() {
  mkdirSync(OUT_ROOT, { recursive: true })
  for (const land of Object.keys(LAND_RECIPES)) {
    const buf = renderCard(land)
    const png = encodePng(buf.width, buf.height, buf.data)
    const outPath = resolve(OUT_ROOT, `${land}.png`)
    writeFileSync(outPath, png)
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath} (${png.length} bytes)`)
  }
}

main()
