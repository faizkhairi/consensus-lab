import { describe, expect, it } from 'vitest'
import { hunt } from '../src/sim/fuzz'
import { BUG_INFO, onlyBug } from '../src/sim/scenarios'
import { BUG_NAMES, NO_BUGS } from '../src/sim/types'

// The deep gate. CI runs it with a larger FUZZ_SEEDS than the unit suite's smoke test.
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 1000)

describe(`deep fuzz (${SEEDS} seeds)`, () => {
  it('finds no safety violation in correct mode', () => {
    const started = performance.now()
    const result = hunt({ bugs: NO_BUGS, seeds: SEEDS })
    const seconds = (performance.now() - started) / 1000
    console.log(
      `correct mode: ${result.tried} seeds, ${result.events} events, ${seconds.toFixed(1)} s ` +
        `(${Math.round(result.events / seconds).toLocaleString('en-US')} events/s)`,
    )
    expect(result.found).toBeNull()
  })

  it.each(BUG_NAMES)('catches %s', (name) => {
    const result = hunt({ bugs: onlyBug(name), seeds: SEEDS })
    expect(result.found?.violation.invariant).toBe(BUG_INFO[name].breaks)
  })
})
