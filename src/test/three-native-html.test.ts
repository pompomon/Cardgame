import { beforeEach, describe, expect, it } from 'vitest'
import {
  noteRasterCardArtLoadFailure,
  renderCardTile,
  renderLandIcon,
  resetRasterCardArtLoadFailuresForTests,
} from '../renderers/three/native-html'

describe('Three.js native card tile output', () => {
  beforeEach(() => {
    resetRasterCardArtLoadFailuresForTests()
  })

  it('renders HD card tiles using the shipped PNG as a full-bleed background with an overlaid label', () => {
    const html = renderCardTile({
      name: 'Forest',
      serializedKey: 'Forest',
      displayName: 'Gravebloom Dryad',
      assetSlug: 'gravebloom-dryad',
    }, 'hd')
    expect(html).toContain('src="/cards/hd/gravebloom-dryad.png"')
    expect(html).toContain('data-card-art="gravebloom-dryad"')
    expect(html).toContain('Gravebloom Dryad')
    expect(html).not.toContain('>Forest<')
    // HD tile uses a dedicated background-image structure (not the small
    // `card-tile-icon` glyph) so the PNG can fill the entire tile.
    expect(html).toContain('card-tile-bg')
    expect(html).toContain('card-tile-label')
    expect(html).toContain('card-tile--raster')
    expect(html).not.toContain('card-tile-icon')
    // Photoreal HD falls back to the geometric hd-fallback PNG first
    // (raster→raster swap, classes preserved), then to procedural SVG via a
    // chained second-hop onerror. Both URLs appear in the initial render.
    expect(html).toContain('onerror=')
    expect(html).toContain('/cards/hd-fallback/gravebloom-dryad.png')
    // The chained second-hop handler embeds the procedural URL so it can reach
    // procedural SVG even when the first fallback raster also fails.
    expect(html).toContain('data:image/svg+xml')
  })

  it('renders Monochrome card tiles using the shipped creature PNG with overlay (no raster fallback layer)', () => {
    const html = renderCardTile('Forest', 'monochrome')
    expect(html).toContain('src="/cards/monochrome/gravebloom-dryad.png"')
    expect(html).toContain('card-tile-bg')
    expect(html).toContain('card-tile-label')
    expect(html).toContain('card-tile--raster')
    expect(html).toContain('onerror=')
    // Monochrome has no intermediate raster fallback, so the onerror swap
    // goes directly to the procedural SVG and drops the raster classes.
    expect(html).toContain('data:image/svg+xml')
    expect(html).not.toContain('/cards/hd-fallback/')
    expect(html).toContain("this.classList.remove(&#39;card-tile-bg&#39;)")
    expect(html).toContain("this.closest(&#39;.card-tile--raster&#39;)?.classList.remove(&#39;card-tile--raster&#39;)")
  })

  it('renders Classic card tiles using the procedural SVG and palette swatch', () => {
    const html = renderCardTile('Mountain', 'classic')
    expect(html).not.toContain('src="/cards/classic/rooftop-gargoyle.png"')
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).toContain('--tile-fill:')
    expect(html).not.toContain('card-tile--raster')
    expect(html).not.toContain('card-tile-icon--raster')
    expect(html).not.toContain('onerror=')
    expect(html).toContain('Rooftop Gargoyle')
    expect(html).toContain('data-card-art="rooftop-gargoyle"')
  })

  it('keeps the procedural icon for tiny action glyphs even in HD mode', () => {
    const html = renderLandIcon('Island', 'hd', 16, 'action-icon', { forceProcedural: true })
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).not.toContain('/cards/hd/signal-siren.png')
    expect(html).not.toContain('action-icon--raster')
    expect(html).not.toContain('onerror=')
  })

  it('uses the HD PNG (with raster class) for normal-sized HD glyphs and chains to the hd-fallback raster first', () => {
    const html = renderLandIcon('Swamp', 'hd', 22, 'card-tile-icon')
    expect(html).toContain('src="/cards/hd/memory-vampire.png"')
    expect(html).toContain('card-tile-icon--raster')
    expect(html).toContain('/cards/hd-fallback/memory-vampire.png')
    // The chained second-hop handler removes the raster class when the raster
    // fallback also fails; the procedural URL is embedded for that second hop.
    expect(html).toContain("this.classList.remove(&#39;card-tile-icon--raster&#39;)")
    expect(html).toContain('data:image/svg+xml')
  })

  it('advances to the geometric hd-fallback raster after the photoreal HD URL has failed in-session', () => {
    noteRasterCardArtLoadFailure('/cards/hd/gravebloom-dryad.png')
    const iconHtml = renderLandIcon('Forest', 'hd', 22, 'card-tile-icon')
    // Now serves the geometric raster fallback directly; onerror drops to
    // procedural SVG and strips raster classes.
    expect(iconHtml).toContain('src="/cards/hd-fallback/gravebloom-dryad.png"')
    expect(iconHtml).toContain('card-tile-icon--raster')
    expect(iconHtml).toContain('onerror=')
    expect(iconHtml).toContain('data:image/svg+xml')
    expect(iconHtml).toContain("this.classList.remove(&#39;card-tile-icon--raster&#39;)")

    const tileHtml = renderCardTile('Forest', 'hd')
    expect(tileHtml).toContain('src="/cards/hd-fallback/gravebloom-dryad.png"')
    expect(tileHtml).toContain('card-tile--raster')
  })

  it('uses procedural art directly after both raster URLs have failed in-session', () => {
    noteRasterCardArtLoadFailure('/cards/hd/gravebloom-dryad.png')
    noteRasterCardArtLoadFailure('/cards/hd-fallback/gravebloom-dryad.png')
    const iconHtml = renderLandIcon('Forest', 'hd', 22, 'card-tile-icon')
    expect(iconHtml).toContain('src="data:image/svg+xml')
    expect(iconHtml).not.toContain('/cards/hd/gravebloom-dryad.png')
    expect(iconHtml).not.toContain('/cards/hd-fallback/gravebloom-dryad.png')
    expect(iconHtml).not.toContain('card-tile-icon--raster')
    expect(iconHtml).not.toContain('onerror=')

    const tileHtml = renderCardTile('Forest', 'hd')
    expect(tileHtml).not.toContain('card-tile--raster')
    expect(tileHtml).toContain('--tile-fill:')
  })

  it('renders a face-down placeholder tile for the hidden-hand sentinel name', () => {
    const html = renderCardTile({
      name: '__hidden__',
      serializedKey: 'Plains',
      displayName: 'Echo Doppelgänger',
      assetSlug: 'untrusted-override',
    }, 'classic')
    expect(html).toContain('card-tile--hidden')
    expect(html).toContain('aria-label="Hidden card"')
    // Must not leak any land name into the rendered tile.
    expect(html).not.toMatch(/Forest|Island|Mountain|Plains|Swamp/)
    expect(html).not.toMatch(/Echo|Doppelgänger|echo-doppelganger|data-card-art/)
  })

  it('keeps Unicode display copy separate from stable palette and legacy art identity', () => {
    const html = renderCardTile({
      name: 'untrusted legacy text',
      serializedKey: 'Plains',
      displayName: 'Echo Doppelgänger <script>',
      assetSlug: 'echo-doppelganger',
    }, 'hd')
    expect(html).toContain('src="/cards/hd/echo-doppelganger.png"')
    expect(html).toContain('three-card--plains')
    expect(html).toContain('data-card-art="echo-doppelganger"')
    expect(html).toContain('Echo Doppelgänger &lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
