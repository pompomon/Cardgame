import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'

export interface AppRenderer {
  mount(container: HTMLElement, controller: ControllerApi): void
  render(view: AppViewModel): void
  unmount(): void
}
