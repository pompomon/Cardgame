// The rule lives in the engine so AI search can use it without importing
// from `src/app/`; this re-export keeps existing app imports working.
export { activeActor } from '../game/engine'
