// Composes the gameplay board render pass for the cardgame scene: header,
// battlefields, player info panels, and hand + phase controls. Each concern is a focused module
// (game-header.ts/battlefield-view.ts/player-info.ts/hand-controls.ts);
// this class only sequences them and owns nothing itself. Extracted from
// CardgameScene so "what does the board look like right now" is separate
// from scene lifecycle/input wiring.
import type Phaser from 'phaser'
import type { AppViewModel } from '../../app/types'
import type { GameAction } from '../../game/types'
import type { BattlefieldTargetsController } from './battlefield-targets'
import { renderBattlefields } from './battlefield-view'
import type { CardPreviewController } from './card-preview-controller'
import type { RetainedCardSyncOptions } from './card-view-registry'
import type { EffectController } from './effect-controller'
import { renderGameHeader } from './game-header'
import { renderHandAndControls } from './hand-controls'
import type { SceneLayout } from './layout'
import { renderPlayerInfoBlocks } from './player-info'
import type { TargetPickerController } from './target-picker'

export interface GameplayPresenterContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  getVisualStyle: () => AppViewModel['cardVisualStyle']
  submitAction: (action: GameAction) => void
  createButton: (label: string, x: number, y: number, onClick: () => void, width?: number, height?: number, fontSize?: string) => Phaser.GameObjects.Container
  getCardPreview: () => CardPreviewController | null
  effectController: EffectController
  battlefieldTargets: BattlefieldTargetsController
  targetPicker: TargetPickerController
  setStatus: (message: string) => void
  setBattlefieldDropZone: (zone: Phaser.GameObjects.Zone | null) => void
  syncRetainedCard: (options: RetainedCardSyncOptions) => Phaser.GameObjects.Container | null
  openMenuOverlay: (view: AppViewModel) => void
}

export class GameplayPresenter {
  private readonly ctx: GameplayPresenterContext

  constructor(ctx: GameplayPresenterContext) {
    this.ctx = ctx
  }

  renderGame(view: AppViewModel, presentedActor = view.game?.actor ?? 0): void {
    const game = view.game
    if (!game) {
      return
    }
    const { ctx } = this

    renderGameHeader(ctx, game, view)

    renderBattlefields(ctx, game, presentedActor)
    renderPlayerInfoBlocks(ctx, view, presentedActor)
    renderHandAndControls(ctx, game, presentedActor)
  }
}
