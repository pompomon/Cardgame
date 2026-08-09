import Phaser from 'phaser'
import type { CardPreviewContext } from '../card-preview'
import { isCardPreviewSuppressed } from '../card-preview'
import { computeCardPreviewLayout } from './card-preview'
import { DEPTH_CARD_PREVIEW_OVERLAY } from './depth'
import type { SceneLayout } from './layout'

const TAP_DISTANCE = 8

export interface CardPreviewController {
  bind(card: Phaser.GameObjects.Container, label: string, sourceDimensions?: { width: number; height: number }): void
  clear(): void
  destroy(): void
}

export function buildCardPreviewContext(
  phase: CardPreviewContext['phase'] | null,
  pendingPlayLandTargetSelection: boolean,
  menuOpen: boolean,
): CardPreviewContext | null {
  return phase ? { phase, pendingPlayLandTargetSelection, menuOpen } : null
}

export function createCardPreviewController(options: {
  scene: Phaser.Scene
  getRoot: () => Phaser.GameObjects.Container | null
  getLayout: () => SceneLayout
  getContext: () => CardPreviewContext | null
  renderCard: (label: string) => Phaser.GameObjects.Container
}): CardPreviewController {
  let overlay: Phaser.GameObjects.Container | null = null
  let pinnedLabel: string | null = null
  let sourcePointerActive = false

  const clear = (): void => {
    overlay?.destroy(true)
    overlay = null
    pinnedLabel = null
    sourcePointerActive = false
  }
  const show = (label: string, pinned: boolean): void => {
    const context = options.getContext()
    if (!context || isCardPreviewSuppressed(context)) {
      clear()
      return
    }
    clear()
    const layout = options.getLayout()
    const previewLayout = computeCardPreviewLayout({
      viewportWidth: layout.width,
      viewportHeight: layout.height,
      safeAreaLeft: layout.safeAreaLeft,
      safeAreaTop: layout.safeAreaTop,
      safeAreaWidth: layout.safeAreaWidth,
      safeAreaHeight: layout.safeAreaHeight,
      cardWidth: layout.cardWidth,
      cardHeight: layout.cardHeight,
      margin: layout.margin,
    })
    const card = options.renderCard(label)
    card.setPosition(previewLayout.centerX, previewLayout.centerY)
    card.setScale(previewLayout.scale)
    overlay = options.scene.add.container(0, 0, [card]).setDepth(DEPTH_CARD_PREVIEW_OVERLAY)
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      overlay = null
    })
    options.getRoot()?.add(overlay)
    pinnedLabel = pinned ? label : null
  }

  const onScenePointerDown = (): void => {
    if (pinnedLabel !== null && !sourcePointerActive) {
      clear()
    }
  }
  options.scene.input.on('pointerdown', onScenePointerDown)

  return {
    bind(card, label, sourceDimensions) {
      const layout = options.getLayout()
      card.setSize(
        sourceDimensions?.width ?? layout.cardWidth,
        sourceDimensions?.height ?? layout.cardHeight,
      )
      if (!card.input) {
        card.setInteractive({ useHandCursor: true })
      }
      let downX = 0
      let downY = 0
      let dragged = false
      card.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        if (!pointer.wasTouch && pinnedLabel === null) {
          show(label, false)
        }
      })
      card.on('pointerout', () => {
        sourcePointerActive = false
        if (pinnedLabel === null) {
          clear()
        }
      })
      card.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        sourcePointerActive = true
        downX = pointer.x
        downY = pointer.y
        dragged = false
      })
      card.on('dragstart', () => {
        dragged = true
        clear()
      })
      card.on('dragend', () => {
        sourcePointerActive = false
      })
      card.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.wasCanceled || dragged || Phaser.Math.Distance.Between(downX, downY, pointer.x, pointer.y) > TAP_DISTANCE) {
          sourcePointerActive = false
          return
        }
        if (pinnedLabel === label) {
          clear()
        } else {
          show(label, true)
        }
        sourcePointerActive = false
      })
    },
    clear,
    destroy() {
      clear()
      options.scene.input.off('pointerdown', onScenePointerDown)
    },
  }
}
