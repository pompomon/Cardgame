// One-off operator script: generate photoreal HD card art for the five
// Urban Creatures and write slugged 1024×1024 PNGs to `public/cards/hd/`.
//
// This script is *not* run by CI, `npm run build`, lint, or test. It is
// invoked manually by a developer with an image-generation API key when
// the photoreal art needs to be (re)generated. The geometric HD art
// produced by `scripts/generate-card-art.mjs` is shipped at
// `public/cards/hd-fallback/` and serves as the deterministic runtime
// fallback when a photoreal asset is missing or fails to load.
//
// Usage:
//   IMAGE_GEN_API_KEY=sk-... npm run generate:photoreal-card-art
//   IMAGE_GEN_API_KEY=sk-... node scripts/generate-photoreal-card-art.mjs --force
//   IMAGE_GEN_API_KEY=sk-... node scripts/generate-photoreal-card-art.mjs --card=gravebloom-dryad
//   IMAGE_GEN_API_KEY=sk-... node scripts/generate-photoreal-card-art.mjs --card=Forest
//
// Environment variables (all optional except the API key):
//   IMAGE_GEN_API_KEY  Required. Falls back to OPENAI_API_KEY for convenience.
//   IMAGE_GEN_MODEL    Image model to request. Default: gpt-image-1.
//   IMAGE_GEN_ENDPOINT HTTPS endpoint to POST the generation request to.
//                      Default: https://api.openai.com/v1/images/generations.
//   IMAGE_GEN_SIZE     Output size string passed to the API. Default: 1024x1024.
//                      Must match `<n>x<n>` (square); the renderers and the
//                      asset-file test require square art at least 256×256.
//
// CLI flags:
//   --force            Overwrite existing PNGs (default: skip creatures that
//                      already have an art file on disk).
//   --card=<selector>  Only (re)generate the exact catalog slug or legacy
//                      serialized key. Repeatable and case-sensitive.
//
// Output files: `public/cards/hd/<asset-slug>.png`, 1024×1024 (or the requested
// size), one per creature in scope. The file is replaced atomically so a
// partial write cannot corrupt a previously good asset.

import { Buffer } from 'node:buffer'
import { mkdirSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORDERED_CARD_VISUAL_RECIPES } from '../src/app/card-visual-recipes.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = resolve(HERE, '..', 'public', 'cards', 'hd')

const DEFAULT_MODEL = 'gpt-image-1'
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/images/generations'
const DEFAULT_SIZE = '1024x1024'

const COLOR_DIRECTION = Object.freeze({
  Forest: 'emerald green and living-vine highlights',
  Island: 'electric blue and cool radio-signal highlights',
  Mountain: 'brick red and warm rooftop highlights',
  Plains: 'ivory, gold, and reflected white light',
  Swamp: 'black, deep purple, and pale memory-wisp highlights',
})

const CREATURE_PROMPTS = Object.freeze(Object.fromEntries(
  ORDERED_CARD_VISUAL_RECIPES.map((recipe) => [
    recipe.serializedKey,
    [
      `A painterly photorealistic urban-fantasy portrait of ${recipe.subject}.`,
      `${recipe.abilityCue}.`,
      `Use ${COLOR_DIRECTION[recipe.serializedKey]}.`,
      'One immediately readable centered silhouette, atmospheric modern-city background, square composition, safe crop around the subject, dramatic but high-contrast lighting, no embedded text, no logos, no branded symbols, no border, no UI.',
    ].join(' '),
  ]),
))

const CARD_BY_SELECTOR = new Map()
for (const recipe of ORDERED_CARD_VISUAL_RECIPES) {
  CARD_BY_SELECTOR.set(recipe.serializedKey, recipe)
  CARD_BY_SELECTOR.set(recipe.assetSlug, recipe)
}
const EXPECTED_SELECTORS = ORDERED_CARD_VISUAL_RECIPES
  .flatMap((recipe) => [recipe.serializedKey, recipe.assetSlug])
  .join(', ')

function parseArgs(argv) {
  const args = { force: false, cards: [] }
  for (const arg of argv.slice(2)) {
    if (arg === '--force') {
      args.force = true
    } else if (arg.startsWith('--card=')) {
      const value = arg.slice('--card='.length)
      const recipe = CARD_BY_SELECTOR.get(value)
      if (!recipe) {
        throw new Error(`unknown --card value '${value}'. Expected one of: ${EXPECTED_SELECTORS}`)
      }
      if (!args.cards.includes(recipe)) args.cards.push(recipe)
    } else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        [
          'Usage: node scripts/generate-photoreal-card-art.mjs [--force] [--card=selector ...]',
          '',
          'Generates photoreal HD card art at public/cards/hd/<asset-slug>.png.',
          `Selectors: ${EXPECTED_SELECTORS}`,
          'Requires IMAGE_GEN_API_KEY (or OPENAI_API_KEY) in the environment.',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`unrecognized argument '${arg}'. Use --help for usage.`)
    }
  }
  if (args.cards.length === 0) {
    args.cards = [...ORDERED_CARD_VISUAL_RECIPES]
  }
  return args
}

function validateSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) {
    throw new Error(`IMAGE_GEN_SIZE must be of the form <n>x<n> (got '${size}')`)
  }
  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  if (width !== height) {
    throw new Error(`IMAGE_GEN_SIZE must be square (got '${size}')`)
  }
  if (width < 256) {
    throw new Error(`IMAGE_GEN_SIZE must be at least 256x256 (got '${size}')`)
  }
  return { width, height }
}

async function generateOne({ recipe, apiKey, model, endpoint, size }) {
  const prompt = CREATURE_PROMPTS[recipe.serializedKey]
  // eslint-disable-next-line no-console
  console.log(`[${recipe.assetSlug}] requesting ${model} @ ${size}…`)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      n: 1,
      // Request a raw base64 PNG payload so we don't need a second HTTP hop
      // to fetch an image URL. `gpt-image-1` always returns b64_json; if a
      // different model is configured via IMAGE_GEN_MODEL the script will
      // also handle URL-style responses below.
      response_format: 'b64_json',
    }),
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '<no body>')
    throw new Error(`${endpoint} responded ${response.status} ${response.statusText}: ${errBody}`)
  }
  const payload = await response.json()
  const item = Array.isArray(payload?.data) ? payload.data[0] : null
  if (!item) {
    throw new Error(`unexpected response shape: missing data[0] (${JSON.stringify(payload).slice(0, 200)}…)`)
  }
  if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
    return Buffer.from(item.b64_json, 'base64')
  }
  if (typeof item.url === 'string' && item.url.length > 0) {
    const imgResp = await fetch(item.url)
    if (!imgResp.ok) {
      throw new Error(`failed to download generated image from ${item.url}: ${imgResp.status} ${imgResp.statusText}`)
    }
    return Buffer.from(await imgResp.arrayBuffer())
  }
  throw new Error('response did not contain b64_json or url')
}

function writeAtomically(path, bytes) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, bytes)
  renameSync(tmp, path)
}

async function main() {
  const args = parseArgs(process.argv)
  const apiKey = process.env.IMAGE_GEN_API_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error(
      [
        'error: missing API key',
        'Set IMAGE_GEN_API_KEY (or OPENAI_API_KEY) in the environment.',
        'Example: IMAGE_GEN_API_KEY=sk-... npm run generate:photoreal-card-art',
      ].join('\n'),
    )
    process.exit(2)
  }
  const model = process.env.IMAGE_GEN_MODEL ?? DEFAULT_MODEL
  const endpoint = process.env.IMAGE_GEN_ENDPOINT ?? DEFAULT_ENDPOINT
  const size = process.env.IMAGE_GEN_SIZE ?? DEFAULT_SIZE
  validateSize(size)

  mkdirSync(OUT_ROOT, { recursive: true })

  let written = 0
  let skipped = 0
  for (const recipe of args.cards) {
    const outPath = resolve(OUT_ROOT, `${recipe.assetSlug}.png`)
    if (!args.force && existsSync(outPath)) {
      // eslint-disable-next-line no-console
      console.log(`[${recipe.assetSlug}] already exists — skipping (pass --force to overwrite)`)
      skipped += 1
      continue
    }
    const bytes = await generateOne({ recipe, apiKey, model, endpoint, size })
    writeAtomically(outPath, bytes)
    // eslint-disable-next-line no-console
    console.log(`[${recipe.assetSlug}] wrote ${outPath} (${bytes.length} bytes)`)
    written += 1
  }
  // eslint-disable-next-line no-console
  console.log(`done: wrote ${written}, skipped ${skipped}`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
