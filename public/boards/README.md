# Board backgrounds

Three.js loads board backgrounds from:

```text
public/boards/<theme>/table-1280x720.png
public/boards/<theme>/table-1280x720-mono.png
public/boards/<theme>/ambience-256x256.png
```

The configured themes are `arcane`, `grove`, and `volcanic`. Files are committed
static assets; rendering does not call an external generation service.

- Table images must be PNG, landscape, and at least `1280×720`.
- Ambience atlases must be PNG and at least `256×256`.
- `*-mono.png` is used for the monochrome visual style.
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
