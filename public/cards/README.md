# Card art

Card images served as static assets to both the DOM and Phaser renderers.

## Layout

```
public/cards/
├─ card-back.png            # Shared card-back asset (not currently used by Phaser renderer)
├─ classic/
│  ├─ Forest.png
│  ├─ Island.png
│  ├─ Mountain.png
│  ├─ Plains.png
│  └─ Swamp.png
├─ hd/                     # Photoreal painted landscapes (one per land).
│  └─ ...
├─ hd-fallback/            # Geometric HD raster used as the runtime fallback for `hd`.
│  └─ ...
└─ monochrome/
   └─ ...
```

- One primary PNG per `(cardVisualStyle, BasicLand)` pair (3 styles × 5 lands = 15 files), plus the 5 geometric `hd-fallback/` PNGs that back-stop the `hd` photoreal art, plus a single shared `card-back.png` asset.
- The `classic/` PNGs are 256×256 placeholder swatches generated from each style's palette in `src/app/card-visuals.ts`.
- The `hd/` PNGs are 1024×1024 photoreal painted landscapes produced by `scripts/generate-photoreal-card-art.mjs` (manual, one-off, requires an image-generation API key). When a photoreal asset is missing or fails to load, both renderers fall back to the geometric raster shipped at `hd-fallback/<Land>.png` before degrading further to the procedural pixel icon.
- The `hd-fallback/` PNGs are 1024×1024 deterministic geometric art produced by `scripts/generate-card-art.mjs`. Re-running on the same checkout yields byte-identical PNGs, so this directory is CI-friendly.
- The `monochrome/` PNGs are 1024×1024 cartoon-cat compositions also produced by `scripts/generate-card-art.mjs` — one unique cat per land (forest tabby, blue island cat with fish, hissing mountain cat, lounging plains cat, glowing-eyed swamp cat).
- The naming convention is enforced by `src/app/card-art.ts` (`cardArtKey` / `cardArtUrl` / `cardArtFallbackUrl`). Replacing artwork is a drop-in: ship a new PNG at the same path; no code changes are needed.

## Per-style rendering behavior

The two renderers pick their image source differently, but the raster vs procedural decision is centralized via the `isRasterCardVisualStyle(style)` predicate and the `RASTER_CARD_VISUAL_STYLES` set in `src/app/card-visuals.ts`:

- The **DOM renderer** uses the shared helper `cardArtSourceFor(land, style, size, { forceProcedural? })` in `src/app/card-visuals.ts`, which returns `{ primaryUrl, proceduralUrl, isRaster }` — a PNG URL for raster styles with the procedural SVG as an `onerror` fallback, and the procedural SVG for both URLs otherwise.
- The **Phaser renderer** preloads `ALL_CARD_ART` via `preloadCardArt(scene)` and looks textures up directly by `cardArtKey(land, style)` inside `addCardArtToContainer`, falling back to the pixel-template icon when the texture is missing. It consults `isRasterCardVisualStyle` to decide whether to skip the palette `cardFill` rectangle behind the art.

Per-style behavior:

- `hd` is a **raster** style — the shipped photoreal PNG is rendered directly (DOM `<img src="/cards/hd/<Land>.png">`, Phaser `add.image(textureKey)`). The neon palette `cardFill` / `--tile-fill` background is suppressed so the painted art covers the card face, and CSS uses smooth scaling (`image-rendering: auto` via the `--raster` class variants). Both renderers wire up a two-step fallback chain: when the photoreal asset is missing or fails to load they swap to the deterministic geometric raster under `/cards/hd-fallback/<Land>.png`, and only after *that* fails do they degrade to the procedural pixel-template icon (`cardArtFallbackUrl` in `src/app/card-art.ts`, `cardArtSourceFor(...).rasterFallbackUrl` in `src/app/card-visuals.ts`).
- `monochrome` is also a **raster** style — it ships cartoon-cat PNGs (one unique cat per land) rendered the same way as `hd`. There is no intermediate raster fallback; the procedural pixel template is retained as the `onerror` / missing-texture fallback.
- `classic` is a **procedural** style — the shipped PNGs are palette swatches, and most DOM render paths use the inline `landIconDataUrl` SVG built from `PIXEL_TEMPLATES`. CSS keeps `image-rendering: pixelated` for these so the grid stays crisp. Phaser also has these PNGs preloaded but they are visually equivalent to the procedural fallback.
- Tiny inline glyphs (16px action buttons in the DOM renderer) always use the procedural SVG regardless of style (see `cardArtSourceFor(..., { forceProcedural: true })`), since downsampling a 1024×1024 PNG to 16px looks worse and adds bandwidth.

When adding a new visual style, add it to `RASTER_CARD_VISUAL_STYLES` in `src/app/card-visuals.ts` if it ships real painted PNGs. Raster styles must ship real PNGs and will skip the palette background in both renderers; procedural styles render the pixel template from `PIXEL_TEMPLATES`.

## Replacement workflow

1. Produce new square artwork at least 256×256 (HD replacements are typically 1024×1024).
2. Save it as `public/cards/<style>/<Land>.png`, matching the existing filename casing exactly (lands are PascalCase: `Forest`, `Island`, `Mountain`, `Plains`, `Swamp`).
3. Reload the app — Phaser preloads art via `ALL_CARD_ART` on scene boot and the DOM renderer references the PNGs by URL, so the new file is picked up automatically. The service worker uses a network-first strategy for `/cards/*`, so online clients refresh to updated same-path PNGs while still keeping offline fallback in cache.

If a file is missing or fails to load, both renderers degrade gracefully along the staged chain documented above. For `hd` the chain is photoreal PNG → geometric raster at `/cards/hd-fallback/<Land>.png` → procedural pixel icon (`landPixelRects`). For other raster styles (e.g. `monochrome`) there is no intermediate raster layer so the renderer drops straight to the procedural pixel icon. The DOM renderer wires this up via successive `onerror` swaps (the first hop may swap to another raster URL while keeping the `--raster` classes); the Phaser renderer preloads both the primary and the fallback textures and `addCardArtToContainer` walks them in order before logging the failing key once per `(style, land)` pair.

## Regenerating the geometric fallback assets

The geometric HD-fallback art and the monochrome cartoon-cat art are produced deterministically by a Node script that depends only on the Node standard library (no extra npm packages):

```
npm run generate:card-art
```

This (re)writes `public/cards/hd-fallback/*.png` and `public/cards/monochrome/*.png`. Re-running on the same checkout yields byte-identical output. If you change the recipe in `scripts/generate-card-art.mjs`, regenerate and commit the resulting PNGs alongside the change. This script is CI-safe and does not need network access or API keys.

## Regenerating the photoreal HD art

The 5 photoreal HD PNGs shipped at `public/cards/hd/<Land>.png` are produced by a one-off operator script that calls a hosted image-generation API. The script is **not** run by CI, `npm run build`, lint, or test — it is invoked manually by a developer when the photoreal art needs to be (re)generated, and the resulting PNGs are committed to the repo.

```
IMAGE_GEN_API_KEY=sk-... npm run generate:photoreal-card-art
```

CLI flags:

- `--force` — overwrite existing PNGs (default: skip lands that already have an art file on disk).
- `--land=<Name>` — only (re)generate the named land. Repeatable. Case-sensitive PascalCase, matching `BASIC_LANDS` (`Forest`, `Island`, `Mountain`, `Plains`, `Swamp`).

Environment variables (all optional except the API key):

- `IMAGE_GEN_API_KEY` — required (also accepts `OPENAI_API_KEY` for convenience).
- `IMAGE_GEN_MODEL` — image model to request. Default: `gpt-image-1`.
- `IMAGE_GEN_ENDPOINT` — HTTPS endpoint to POST the generation request to. Default: `https://api.openai.com/v1/images/generations`.
- `IMAGE_GEN_SIZE` — output size string (`<n>x<n>`, square, at least 256). Default: `1024x1024`.

The script is non-deterministic (re-runs may produce different art). After regenerating, review the new PNGs, pick the best outputs, and commit them. The geometric `hd-fallback/` art continues to back-stop the runtime fallback if a new photoreal PNG ever fails to load.

## Style slots

The current visual style slots, mirrored from `src/app/card-visual-styles.ts`:

- `classic` — palette-driven flat swatches (placeholder, procedural).
- `hd` — high-resolution photoreal painted landscapes (raster; replaces the legacy `neon` slot). Backed by a deterministic geometric raster at `hd-fallback/` for offline / missing-asset fallback before the procedural pixel template.
- `monochrome` — cartoon-cat illustrations, one unique cat per land (raster).

Users who had previously selected `neon` are migrated to `hd` on first read (`src/app/card-visual-style-selection.ts`).
