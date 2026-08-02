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
import type { BasicLand } from '../../game/types'
import { renderStaticCard } from './card-factory'
import {
  computeEffectAnchorFromLayout,
  computeEffectSourceAnchor,
  projectBattlefieldCardPlacement,
  type BattlefieldCardPlacement,
} from './effect-anchoring'
import { EffectTargetRetention } from './effect-target-retention'
import {
  clearEffectQueue,
  createEffectQueue,
  effectDescriptorForEvent,
  enqueueEffect,
  playAbilityEffect,
  pumpEffectQueue,
  type EffectQueueState,
} from './effects'
import type { SceneLayout } from './layout'
import { isPhoneSizedViewport } from './quality'

const MAX_CARD_POSITION_HISTORY = 200

export interface EffectControllerContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getCurrentView: () => AppViewModel | null
  renderRetainedCard?: (
    x: number,
    y: number,
    cardName: BasicLand,
    visualStyle: AppViewModel['cardVisualStyle'],
  ) => Phaser.GameObjects.Container
  playEffect?: typeof playAbilityEffect
}

export class EffectController {
  private readonly ctx: EffectControllerContext
  private readonly effectQueue: EffectQueueState = createEffectQueue()
  private lastAnimatedEventCount = 0
  // Maps instanceId → EffectAnchor for every card currently visible in both
  // battlefields. Populated (and cleared) on every renderBattlefields pass.
  private cardPositionRegistry = new Map<string, BattlefieldCardPlacement>()
  private previousCardPositionRegistry = new Map<string, BattlefieldCardPlacement>()
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
    for (const [instanceId, placement] of this.cardPositionRegistry) {
      this.previousCardPositionRegistry.delete(instanceId)
      this.previousCardPositionRegistry.set(instanceId, placement)
    }
    while (this.previousCardPositionRegistry.size > MAX_CARD_POSITION_HISTORY) {
      const oldest = this.previousCardPositionRegistry.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.previousCardPositionRegistry.delete(oldest)
    }
    this.cardPositionRegistry.clear()
  }

  recordCardPosition(instanceId: string, placement: BattlefieldCardPlacement): void {
    this.cardPositionRegistry.set(instanceId, placement)
  }

  processAbilityEffects(view: AppViewModel): void {
    const game = view.game
    if (!game) {
      return
    }
    const layout = this.ctx.getLayout()
    this.retainedEffectTargets.update((placement) => (
      projectBattlefieldCardPlacement(placement, layout, game.actor)
    ))
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
        if (descriptor.sourceInstanceId) {
          const sourcePlacement = this.cardPositionRegistry.get(descriptor.sourceInstanceId)
            ?? this.previousCardPositionRegistry.get(descriptor.sourceInstanceId)
          descriptor.sourcePlacement = sourcePlacement ? { ...sourcePlacement } : undefined
        }
        if (descriptor.targetInstanceId) {
          const targetPlacement = this.cardPositionRegistry.get(descriptor.targetInstanceId)
            ?? this.previousCardPositionRegistry.get(descriptor.targetInstanceId)
          descriptor.targetPlacement = targetPlacement ? { ...targetPlacement } : undefined
        }
        const dropped = enqueueEffect(this.effectQueue, descriptor)
        for (const droppedDescriptor of dropped) {
          this.retainedEffectTargets.releaseMountainTarget(droppedDescriptor)
        }
        if (!dropped.includes(descriptor) && descriptor.targetPlacement) {
          const targetAnchor = projectBattlefieldCardPlacement(descriptor.targetPlacement, layout, game.actor)
          this.retainedEffectTargets.retainMountainTarget(
            descriptor,
            descriptor.targetPlacement,
            targetAnchor,
            this.ctx.renderRetainedCard
              ?? ((x, y, cardName, cardVisualStyle) => renderStaticCard(
                this.ctx.scene,
                layout,
                x,
                y,
                cardName,
                { visualStyle: cardVisualStyle },
              )),
          )
        }
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
            layout,
            latest.game?.actor ?? descriptor.actor,
            this.cardPositionRegistry,
            this.previousCardPositionRegistry,
          )
          const quality = isPhoneSizedViewport(scene.scale.width, scene.scale.height) ? 'reduced' : 'full'
          const playEffect = this.ctx.playEffect ?? playAbilityEffect
          playEffect(scene, anchor, descriptor, durationMs, () => {
            this.retainedEffectTargets.releaseMountainTarget(descriptor)
            done()
          }, quality)
        },
      }
    })
  }
}
