// One-off operator script: generate photoreal HD card art for the 5 basic
// lands and write the resulting 1024×1024 PNGs to `public/cards/hd/`.
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
//   IMAGE_GEN_API_KEY=sk-... node scripts/generate-photoreal-card-art.mjs --land=Forest
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
//   --force            Overwrite existing PNGs (default: skip lands that
//                      already have an art file on disk).
//   --land=<Name>      Only (re)generate the named land. Repeatable. Case
//                      sensitive (PascalCase, matches `BASIC_LANDS`).
//
// Output files: `public/cards/hd/<Land>.png`, 1024×1024 (or the requested
// size), one per land in scope. The file is replaced atomically so a
// partial write cannot corrupt a previously good asset.

import { Buffer } from 'node:buffer'
import { mkdirSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = resolve(HERE, '..', 'public', 'cards', 'hd')

const DEFAULT_MODEL = 'gpt-image-1'
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/images/generations'
const DEFAULT_SIZE = '1024x1024'

// One painterly-photoreal landscape prompt per basic land. Prompts are
// intentionally explicit about the *square*, top-down/eye-level framing and
// the absence of text/UI elements so the resulting PNG drops straight into
// the card slot without further cropping.
const LAND_PROMPTS = Object.freeze({
  Forest:
    'A lush ancient temperate forest at golden hour, towering moss-covered trees, dappled sunlight streaming through a leafy emerald canopy, ferns and wildflowers on the forest floor, painterly photorealistic landscape, rich saturated greens, square composition, centered framing, no people, no text, no logos, no borders, no UI',
  Island:
    'A serene tropical island lagoon seen from a low altitude, crystalline turquoise water, a crescent of white sand beach, palm trees, soft sunlight, scattered cumulus clouds reflecting on the water, painterly photorealistic landscape, vivid blues and aquamarine, square composition, centered framing, no people, no text, no logos, no borders, no UI',
  Mountain:
    'A dramatic snow-capped mountain peak under a clear morning sky, sharp granite ridges, drifting clouds halfway up the slope, an alpine valley in the foreground with scree and patches of snow, painterly photorealistic landscape, cool greys and crisp whites with warm sunlit highlights, square composition, centered framing, no people, no text, no logos, no borders, no UI',
  Plains:
    'A vast sunlit golden grassland under a tall blue sky, gently rolling hills, scattered wildflowers, a lone distant oak tree, soft warm afternoon light, painterly photorealistic landscape, warm honey and amber tones, square composition, centered framing, no people, no text, no logos, no borders, no UI',
  Swamp:
    'A misty haunted swamp at dusk, twisted dead trees draped in spanish moss, dark glassy water reflecting purple-grey clouds, glowing fireflies, lily pads and reeds in the foreground, painterly photorealistic landscape, deep violets and sickly greens, square composition, centered framing, no people, no text, no logos, no borders, no UI',
})

const ALL_LANDS = Object.keys(LAND_PROMPTS)

function parseArgs(argv) {
  const args = { force: false, lands: [] }
  for (const arg of argv.slice(2)) {
    if (arg === '--force') {
      args.force = true
    } else if (arg.startsWith('--land=')) {
      const value = arg.slice('--land='.length)
      if (!ALL_LANDS.includes(value)) {
        throw new Error(`unknown --land value '${value}'. Expected one of: ${ALL_LANDS.join(', ')}`)
      }
      args.lands.push(value)
    } else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        [
          'Usage: node scripts/generate-photoreal-card-art.mjs [--force] [--land=Name ...]',
          '',
          'Generates photoreal HD card art at public/cards/hd/<Land>.png.',
          'Requires IMAGE_GEN_API_KEY (or OPENAI_API_KEY) in the environment.',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`unrecognized argument '${arg}'. Use --help for usage.`)
    }
  }
  if (args.lands.length === 0) {
    args.lands = [...ALL_LANDS]
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

async function generateOne({ land, apiKey, model, endpoint, size }) {
  const prompt = LAND_PROMPTS[land]
  // eslint-disable-next-line no-console
  console.log(`[${land}] requesting ${model} @ ${size}…`)
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
  const args = parseArgs(process.argv)
  const model = process.env.IMAGE_GEN_MODEL ?? DEFAULT_MODEL
  const endpoint = process.env.IMAGE_GEN_ENDPOINT ?? DEFAULT_ENDPOINT
  const size = process.env.IMAGE_GEN_SIZE ?? DEFAULT_SIZE
  validateSize(size)

  mkdirSync(OUT_ROOT, { recursive: true })

  let written = 0
  let skipped = 0
  for (const land of args.lands) {
    const outPath = resolve(OUT_ROOT, `${land}.png`)
    if (!args.force && existsSync(outPath)) {
      // eslint-disable-next-line no-console
      console.log(`[${land}] already exists — skipping (pass --force to overwrite)`)
      skipped += 1
      continue
    }
    const bytes = await generateOne({ land, apiKey, model, endpoint, size })
    writeAtomically(outPath, bytes)
    // eslint-disable-next-line no-console
    console.log(`[${land}] wrote ${outPath} (${bytes.length} bytes)`)
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
