import type { Counterexample, ShrinkResult } from '../sim/fuzz'
import type { BugFlags } from '../sim/types'

export type FuzzRequest =
  | {
      readonly type: 'hunt'
      /** Echoed on every response, so the page can drop messages from an earlier hunt. */
      readonly id: number
      readonly bugs: BugFlags
      readonly seeds: number
      readonly startSeed: number
    }
  | { readonly type: 'stop' }

export interface FuzzProgress {
  readonly tried: number
  readonly events: number
  readonly elapsedMs: number
}

export type FuzzResponse = { readonly id: number } & (
  | ({ readonly type: 'progress' } & FuzzProgress)
  /** A violation was found; shrinking starts next. */
  | ({ readonly type: 'found'; readonly counterexample: Counterexample } & FuzzProgress)
  | { readonly type: 'shrunk'; readonly result: ShrinkResult }
  /** Every seed passed. */
  | ({ readonly type: 'clean' } & FuzzProgress)
  | ({ readonly type: 'stopped' } & FuzzProgress)
)
