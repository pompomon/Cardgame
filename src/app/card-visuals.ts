import type { CardVisualStyle } from './types'
import type { BasicLand } from '../game/types'

export interface CardVisualPalette {
  cardFill: string
  cardStroke: string
  cardText: string
  iconPrimary: string
  iconSecondary: string
}

type PixelTone = 'primary' | 'secondary'

export interface PixelRect {
  x: number
  y: number
  size: number
  tone: PixelTone
}

const GRID_SIZE = 16
const TEMPLATE_FOREST = [
  '................',
  '.......#........',
  '......###.......',
  '.....#####......',
  '....#######.....',
  '....#######.....',
  '.....#####......',
  '......###.......',
  '.......#........',
  '.......#........',
  '.......#........',
  '......+#+.......',
  '......+#+.......',
  '......+#+.......',
  '................',
  '................',
]
const TEMPLATE_ISLAND = [
  '................',
  '................',
  '.....######.....',
  '...##++++++##...',
  '..##++++++++##..',
  '..##++++++++##..',
  '.##++++++++++##.',
  '.##++++++++++##.',
  '..##++++++++##..',
  '..##++++++++##..',
  '...##++++++##...',
  '.....######.....',
  '.......##.......',
  '......####......',
  '................',
  '................',
]
const TEMPLATE_MOUNTAIN = [
  '................',
  '................',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...####++####...',
  '..####++++####..',
  '.####++++++####.',
  '####++++++++####',
  '################',
  '..##++++++++##..',
  '..##++++++++##..',
  '..############..',
  '................',
  '................',
]
const TEMPLATE_PLAINS = [
  '................',
  '................',
  '................',
  '.......##.......',
  '.......##.......',
  '....########....',
  '....##++++##....',
  '..############..',
  '..##++++++++##..',
  '################',
  '..##++++++++##..',
  '....##++++##....',
  '....########....',
  '.......##.......',
  '................',
  '................',
]
const TEMPLATE_SWAMP = [
  '................',
  '................',
  '.....######.....',
  '...##++++++##...',
  '..##++++++++##..',
  '..##++++++++##..',
  '..##++++++++##..',
  '...##++++++##...',
  '.....######.....',
  '.......##.......',
  '......####......',
  '....##+##+##....',
  '....##+##+##....',
  '.....######.....',
  '................',
  '................',
]

const PIXEL_TEMPLATES: Record<BasicLand, ReadonlyArray<string>> = {
  Forest: TEMPLATE_FOREST,
  Island: TEMPLATE_ISLAND,
  Mountain: TEMPLATE_MOUNTAIN,
  Plains: TEMPLATE_PLAINS,
  Swamp: TEMPLATE_SWAMP,
}

const paletteByStyleAndLand: Record<CardVisualStyle, Record<BasicLand, CardVisualPalette>> = {
  classic: {
    Forest: { cardFill: '#19482c', cardStroke: '#53a772', cardText: '#d6f9df', iconPrimary: '#b9f1c5', iconSecondary: '#7fd194' },
    Island: { cardFill: '#173a66', cardStroke: '#5f94d0', cardText: '#deebff', iconPrimary: '#b7d9ff', iconSecondary: '#8ebeff' },
    Mountain: { cardFill: '#5c2b1a', cardStroke: '#bf6f4c', cardText: '#ffdfd1', iconPrimary: '#ffc4a8', iconSecondary: '#ff9f75' },
    Plains: { cardFill: '#695d31', cardStroke: '#c8b872', cardText: '#fff8dd', iconPrimary: '#fff2ba', iconSecondary: '#f2dc8b' },
    Swamp: { cardFill: '#362148', cardStroke: '#8a62af', cardText: '#f3e4ff', iconPrimary: '#d9bbff', iconSecondary: '#b694e6' },
  },
  neon: {
    Forest: { cardFill: '#0d2f1d', cardStroke: '#37ff8f', cardText: '#dcffe9', iconPrimary: '#8effbf', iconSecondary: '#37ff8f' },
    Island: { cardFill: '#102c52', cardStroke: '#2ab9ff', cardText: '#e7f6ff', iconPrimary: '#88deff', iconSecondary: '#2ab9ff' },
    Mountain: { cardFill: '#3f1d14', cardStroke: '#ff7b52', cardText: '#ffe5dc', iconPrimary: '#ffb198', iconSecondary: '#ff7b52' },
    Plains: { cardFill: '#3f3613', cardStroke: '#ffe14a', cardText: '#fffde6', iconPrimary: '#fff39d', iconSecondary: '#ffe14a' },
    Swamp: { cardFill: '#241636', cardStroke: '#ca69ff', cardText: '#f7ebff', iconPrimary: '#e2a8ff', iconSecondary: '#ca69ff' },
  },
  monochrome: {
    Forest: { cardFill: '#202020', cardStroke: '#929292', cardText: '#f0f0f0', iconPrimary: '#d0d0d0', iconSecondary: '#a8a8a8' },
    Island: { cardFill: '#1d1d1d', cardStroke: '#858585', cardText: '#f2f2f2', iconPrimary: '#d7d7d7', iconSecondary: '#9f9f9f' },
    Mountain: { cardFill: '#242424', cardStroke: '#989898', cardText: '#f3f3f3', iconPrimary: '#dadada', iconSecondary: '#a6a6a6' },
    Plains: { cardFill: '#222222', cardStroke: '#949494', cardText: '#f4f4f4', iconPrimary: '#dbdbdb', iconSecondary: '#ababab' },
    Swamp: { cardFill: '#1f1f1f', cardStroke: '#8f8f8f', cardText: '#efefef', iconPrimary: '#cecece', iconSecondary: '#9c9c9c' },
  },
}

const rectCache = new Map<string, ReadonlyArray<PixelRect>>()
const iconDataUrlCache = new Map<string, string>()
const stylePreviewDataUrlCache = new Map<string, string>()

function bucketSize(size: number): number {
  return Math.max(8, Math.round(size / 2) * 2)
}

export function bucketIconSize(size: number): number {
  return bucketSize(size)
}

function encodeSvg(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function templateRects(land: BasicLand, targetSize: number): ReadonlyArray<PixelRect> {
  const size = bucketSize(targetSize)
  const cacheKey = `${land}:${size}`
  const cached = rectCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const template = PIXEL_TEMPLATES[land]
  const pixelSize = Math.max(1, Math.floor(size / GRID_SIZE))
  const iconWidth = pixelSize * GRID_SIZE
  const offset = Math.floor((size - iconWidth) / 2)
  const rects: PixelRect[] = []
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const line = template[row] ?? ''
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const symbol = line[col]
      if (symbol !== '#' && symbol !== '+') {
        continue
      }
      rects.push({
        x: offset + col * pixelSize,
        y: offset + row * pixelSize,
        size: pixelSize,
        tone: symbol === '#' ? 'primary' : 'secondary',
      })
    }
  }
  rectCache.set(cacheKey, rects)
  return rects
}

export function cardVisualPaletteFor(land: BasicLand, style: CardVisualStyle): CardVisualPalette {
  return paletteByStyleAndLand[style][land]
}

export function landPixelRects(land: BasicLand, targetSize: number): ReadonlyArray<PixelRect> {
  return templateRects(land, targetSize)
}

export function landIconDataUrl(land: BasicLand, style: CardVisualStyle, targetSize: number): string {
  const size = bucketSize(targetSize)
  const cacheKey = `${land}:${style}:${size}`
  const cached = iconDataUrlCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const palette = cardVisualPaletteFor(land, style)
  // Keep a minimum internal coordinate space so the fixed GRID_SIZE-based icon
  // template remains fully visible even when the rendered output is smaller.
  const internalSize = Math.max(size, GRID_SIZE)
  const rects = landPixelRects(land, internalSize)
  const body = rects.map((rect) => {
    const fill = rect.tone === 'primary' ? palette.iconPrimary : palette.iconSecondary
    return `<rect x="${rect.x}" y="${rect.y}" width="${rect.size}" height="${rect.size}" fill="${fill}" />`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${internalSize} ${internalSize}" shape-rendering="crispEdges">${body}</svg>`
  const dataUrl = encodeSvg(svg)
  iconDataUrlCache.set(cacheKey, dataUrl)
  return dataUrl
}

export function stylePreviewDataUrl(style: CardVisualStyle, targetSize: number): string {
  const size = bucketSize(targetSize)
  const cacheKey = `${style}:${size}`
  const cached = stylePreviewDataUrlCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const lands: BasicLand[] = ['Forest', 'Mountain', 'Island']
  // Use a large internal coordinate space so icons remain centered and fully
  // visible inside their lanes regardless of the rendered display size; SVG
  // scales the viewBox to the requested width/height.
  const internalSize = Math.max(size, GRID_SIZE * lands.length * 2)
  const parts: string[] = []
  lands.forEach((land, index) => {
    const palette = cardVisualPaletteFor(land, style)
    const laneStart = Math.floor((index * internalSize) / lands.length)
    const laneEnd = Math.floor(((index + 1) * internalSize) / lands.length)
    const laneWidth = laneEnd - laneStart
    parts.push(`<rect x="${laneStart}" y="0" width="${laneWidth}" height="${internalSize}" fill="${palette.cardFill}" />`)
    const iconSize = bucketSize(Math.max(GRID_SIZE, Math.floor(Math.min(laneWidth, internalSize) * 0.8)))
    const iconRects = landPixelRects(land, iconSize)
    const xOffset = laneStart + Math.floor((laneWidth - iconSize) / 2)
    const yOffset = Math.floor((internalSize - iconSize) / 2)
    for (const rect of iconRects) {
      const fill = rect.tone === 'primary' ? palette.iconPrimary : palette.iconSecondary
      parts.push(`<rect x="${xOffset + rect.x}" y="${yOffset + rect.y}" width="${rect.size}" height="${rect.size}" fill="${fill}" />`)
    }
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${internalSize} ${internalSize}" shape-rendering="crispEdges">${parts.join('')}</svg>`
  const dataUrl = encodeSvg(svg)
  stylePreviewDataUrlCache.set(cacheKey, dataUrl)
  return dataUrl
}
