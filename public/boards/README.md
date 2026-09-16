# Board backgrounds

Three.js loads board backgrounds from:

```text
public/boards/<theme>/background-hd.png
public/boards/<theme>/background-balanced.png
public/boards/<theme>/background-low.png
public/boards/<theme>/background-fallback.png
public/boards/<theme>/ambience-atlas.png
public/boards/<theme>/ambience-atlas.json
```

The configured themes are `classic`, `moonlit`, and `verdant`. Files are committed
static assets; rendering does not call an external generation service.

- Background images are landscape PNGs: `1920×1080` (`hd`), `1280×720`
  (`balanced`), `960×540` (`low`), and `640×360` (`fallback`).
- Ambience atlases use a `128×64` PNG texture and matching JSON metadata.
- Keep transparent edges where ambience cells require them.

Same-path replacements require a `RUNTIME_ASSET_VERSION` bump in `public/sw.js`
because board assets are network-first with cache fallback. Hashed JavaScript
and CSS bundles do not share this rule.

`src/app/board-assets.ts` defines the canonical base-safe URL mapping. Do not
duplicate board URLs in renderer code, and keep `import.meta.env.BASE_URL` as a
literal member expression.

After adding or replacing assets:

1. Run asset and base-path tests.
2. Build with the production non-root base path.
3. Verify every theme/style online and after a cached offline reload.
4. Inspect aspect-correct cover cropping at desktop, portrait, and short
   landscape sizes.
5. Confirm failed or slow replacements leave the previous background usable.
