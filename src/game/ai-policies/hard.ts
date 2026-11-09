import { hardSearchPolicy } from '../ai-hard'
import type { AiPolicy } from '../ai-policy-types'

// Hard searches sampled deck orders and plays with seeded variety; see
// ai-hard.ts and docs/agent/adr/0003-hard-ai-search.md.
export const hardPolicy: AiPolicy = hardSearchPolicy
