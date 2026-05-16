# Card art

Placeholder card images served as static assets.

## Layout

```
public/cards/
├─ card-back.png            # Generic card back
├─ classic/
│  ├─ Forest.png
│  ├─ Island.png
│  ├─ Mountain.png
│  ├─ Plains.png
│  └─ Swamp.png
├─ neon/
│  └─ ...
└─ monochrome/
   └─ ...
```

- One PNG per `(cardVisualStyle, BasicLand)` pair (3 styles × 5 lands = 15 files), plus a single shared `card-back.png`.
- Files are 256×256 PNGs. The Phaser renderer scales them down to the current card slot, so any square art at this size or larger works.
- The naming convention is enforced by `src/app/card-art.ts` (`cardArtKey` / `cardArtUrl`). Replacing artwork is a drop-in: ship a new PNG at the same path; no code changes are needed.

## Replacement workflow

1. Produce new artwork at 256×256 (or larger square).
2. Save it as `public/cards/<style>/<Land>.png`, matching the existing filename casing exactly (lands are PascalCase: `Forest`, `Island`, `Mountain`, `Plains`, `Swamp`).
3. Reload the app — Phaser preloads art via `ALL_CARD_ART` on scene boot, so the new file is picked up automatically.

If a file is missing or fails to load, the renderer falls back to the procedural pixel icon (`landPixelRects`) so cards remain visible.

## Placeholders shipped today

The PNGs currently in this directory are flat-color placeholders generated from each style's palette in `src/app/card-visuals.ts`. They distinguish lands and styles visually but are not finished art.
