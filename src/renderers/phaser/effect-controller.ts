// Orchestrates the visual ability-resolution effects pipeline for the
// cardgame scene: owns the effect queue, the per-render card position
// registries used to anchor particles/trails, and the "keep a Mountain
// target visible through its destruction effect" retention helper. Extracted
// from CardgameScene so the queue/registry bookkeeping has a single owner
// that both the battlefield renderer (writes positions) and the effect
// pump (reads positions, plays effects) can share.
import type Phaser from 'phaser'
import { durationMsForSpeed } from '../../app/animation-settings'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import type { AppViewModel } from '../../app/types'
import { renderStaticCard } from './card-factory'
import { computeEffectAnchorFromLayout, computeEffectSourceAnchor } from './effect-anchoring'
import { EffectTargetRetention } from './effect-target-retention'
import {
  clearEffectQueue,
  createEffectQueue,
  effectDescriptorForEvent,
  enqueueEffect,
  playAbilityEffect,
  pumpEffectQueue,
  type EffectAnchor,
  type EffectQueueState,
} from './effects'
import type { SceneLayout } from './layout'
import { isPhoneSizedViewport } from './quality'

export interface EffectControllerContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getCurrentView: () => AppViewModel | null
}

export class EffectController {
  private readonly ctx: EffectControllerContext
  private readonly effectQueue: EffectQueueState = createEffectQueue()
  private lastAnimatedEventCount = 0
  // Maps instanceId → EffectAnchor for every card currently visible in both
  // battlefields. Populated (and cleared) on every renderBattlefields pass.
  private cardPositionRegistry = new Map<string, EffectAnchor>()
  private previousCardPositionRegistry = new Map<string, EffectAnchor>()
  private readonly retainedEffectTargets = new EffectTargetRetention()

  constructor(ctx: EffectControllerContext) {
    this.ctx = ctx
  }

  reset(): void {
    clearEffectQueue(this.effectQueue)
    this.retainedEffectTargets.clear()
    this.lastAnimatedEventCount = 0
    this.previousCardPositionRegistry.clear()
    this.cardPositionRegistry.clear()
  }

  // Called once at the top of each renderBattlefields pass so stale
  // positions from the previous render don't leave ghost anchors in the
  // registry across a rematch/new game.
  beginBattlefieldRenderPass(): void {
    this.previousCardPositionRegistry = new Map([
      ...this.previousCardPositionRegistry,
      ...this.cardPositionRegistry,
    ])
    this.cardPositionRegistry.clear()
  }

  recordCardPosition(instanceId: string, anchor: EffectAnchor): void {
    this.cardPositionRegistry.set(instanceId, anchor)
  }

  processAbilityEffects(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }
    const events = game.events
    if (this.lastAnimatedEventCount > events.length) {
      // Engine state went backwards (e.g. replay rewind). Reset and wait
      // for renderView to seed `lastAnimatedEventCount = events.length`.
      clearEffectQueue(this.effectQueue)
      this.retainedEffectTargets.clear()
      this.lastAnimatedEventCount = events.length
      return
    }
    if (view.animationSpeed === 'off') {
      // Drop any pending visuals immediately and snap the marker forward so
      // toggling the setting on later doesn't replay backlog.
      clearEffectQueue(this.effectQueue)
      this.retainedEffectTargets.clear()
      this.lastAnimatedEventCount = events.length
      return
    }
    const visualStyle = view.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    for (let index = this.lastAnimatedEventCount; index < events.length; index += 1) {
      const descriptor = effectDescriptorForEvent(events[index], visualStyle)
      if (descriptor) {
        enqueueEffect(this.effectQueue, descriptor)
      }
    }
    this.lastAnimatedEventCount = events.length

    // `pumpEffectQueue` re-invokes this options getter for every drain, so
    // a mid-queue animationSpeed/durationMs change takes effect on the very
    // next pending entry instead of riding out the queue with stale values
    // captured when the first effect started.
    pumpEffectQueue(this.effectQueue, () => {
      const latest = this.ctx.getCurrentView() ?? view
      const speed = latest.animationSpeed
      return {
        animationSpeed: speed,
        durationMs: durationMsForSpeed(speed),
        run: (descriptor, durationMs, done) => {
          const layout = this.ctx.getLayout()
          const scene = this.ctx.scene
          const anchor = computeEffectAnchorFromLayout(latest, descriptor, layout, this.cardPositionRegistry, this.previousCardPositionRegistry)
          descriptor.sourceAnchor = computeEffectSourceAnchor(
            descriptor,
            this.cardPositionRegistry,
            this.previousCardPositionRegistry,
          )
          const quality = isPhoneSizedViewport(scene.scale.width, scene.scale.height) ? 'reduced' : 'full'
          const releaseTarget = this.retainedEffectTargets.retainMountainTarget(
            descriptor,
            this.previousCardPositionRegistry,
            (x, y, cardName, cardVisualStyle) => renderStaticCard(scene, layout, x, y, cardName, { visualStyle: cardVisualStyle }),
          )
          playAbilityEffect(scene, anchor, descriptor, durationMs, () => { releaseTarget(); done() }, quality)
        },
      }
    })
  }
}
