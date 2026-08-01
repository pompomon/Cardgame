// Shared shape of the composition-root `PhaserRenderer` as seen by the
// Lobby and Cardgame scenes. Declared as a structural interface (not an
// import of the concrete class) so scene modules never import the
// composition root — avoiding a circular dependency between
// `index.ts` → `{lobby,cardgame}-scene.ts` → `index.ts`.
import type { ControllerApi } from '../../app/controller'
import type { AppViewModel } from '../../app/types'
import type { LayoutSafeAreaInsets } from './layout'

export interface PhaserRendererHost {
  readonly currentView: AppViewModel | null
  readonly controller: ControllerApi | null
  safeAreaInsetsForViewport(width: number, height: number): LayoutSafeAreaInsets
  refreshA11yNavForCurrentView(): void
  openRecordingFilePicker(): void
  handleDownloadRecording(): void
}
