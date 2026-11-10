import type { ThreeShell } from '../../renderers/three/layout'

const shell = (profile: ThreeShell['profile'], short = false): ThreeShell => Object.freeze({ profile, short })

export const NARROW_SHELL = shell('narrow')
export const DOCK_SHELL = shell('dock')
export const RAIL_SHELL = shell('rail')
export const SHORT_RAIL_SHELL = shell('rail', true)
export const DESKTOP_SHELL = shell('desktop')

/** A layout viewport and the shell it gets with a coarse (touch) and a fine (mouse) primary pointer. */
export type Fold4Posture = readonly [name: string, width: number, height: number, touch: ThreeShell, mouse: ThreeShell]

/**
 * Estimated layout viewports from the plan's Fold4 postures table. Milestone 0
 * device measurements, keyboard-open variants included, replace these rows.
 */
export const FOLD4_POSTURES: readonly Fold4Posture[] = Object.freeze([
  ['cover portrait in a Chrome tab', 344, 770, NARROW_SHELL, NARROW_SHELL],
  ['cover portrait as an installed PWA', 344, 834, NARROW_SHELL, NARROW_SHELL],
  ['cover portrait at full screen', 344, 882, NARROW_SHELL, NARROW_SHELL],
  ['cover landscape in a Chrome tab', 882, 232, SHORT_RAIL_SHELL, DESKTOP_SHELL],
  ['main portrait in a Chrome tab', 690, 717, DOCK_SHELL, DESKTOP_SHELL],
  ['main portrait at full screen', 690, 829, DOCK_SHELL, DESKTOP_SHELL],
  ['main landscape in a Chrome tab', 829, 578, RAIL_SHELL, DESKTOP_SHELL],
  ['main landscape at full screen', 829, 690, RAIL_SHELL, DESKTOP_SHELL],
] as const)
