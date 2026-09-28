import { describe, expect, it } from 'vitest'
import { hunt, makeCase, runCase, shrink } from '../src/sim/fuzz'
import { BUG_INFO, onlyBug, PINNED } from '../src/sim/scenarios'
import { BUG_NAMES, NO_BUGS } from '../src/sim/types'

describe('fuzz: correct mode', () => {
  // The same harness as the deep `npm run fuzz` gate, at a depth that fits the unit suite.
  it('finds no violation in 300 seeds', () => {
    const result = hunt({ bugs: NO_BUGS, seeds: 300 })
    expect(result.found).toBeNull()
    expect(result.tried).toBe(300)
    expect(result.events).toBeGreaterThan(300 * 1000)
  })

  it('builds the same fault schedule for the same seed', () => {
    expect(makeCase(12, NO_BUGS)).toEqual(makeCase(12, NO_BUGS))
    expect(makeCase(12, NO_BUGS).faults).not.toEqual(makeCase(13, NO_BUGS).faults)
  })
})

// Seed budgets are several times the first hit today, so they catch a regression
// in the fuzzer's reach without pinning exact seeds.
const BUDGET = { commitPriorTerm: 600, forgetVoteOnRestart: 600, skipUpToDateCheck: 50 } as const

describe.each(BUG_NAMES)('fuzz: %s', (name) => {
  const bugs = onlyBug(name)
  const expected = BUG_INFO[name].breaks

  it(`is caught within ${BUDGET[name]} seeds and shrinks to a smaller schedule that still fails`, () => {
    const { found } = hunt({ bugs, seeds: BUDGET[name] })
    expect(found).not.toBeNull()
    if (!found) return
    expect(found.violation.invariant).toBe(expected)

    const { shrunk, runs } = shrink(found)
    expect(runs).toBeGreaterThan(0)
    expect(shrunk.violation.invariant).toBe(expected)
    expect(shrunk.fuzzCase.faults.length).toBeLessThan(found.fuzzCase.faults.length)
    expect(shrunk.fuzzCase.duration).toBe(Math.ceil(shrunk.violation.time) + 1)
    // The shrunk case is itself a deterministic reproduction.
    expect(runCase(shrunk.fuzzCase).violation).toEqual(shrunk.violation)
  })

  it('pinned counterexample still fails, and passes with the bug switched off', () => {
    const pinned = PINNED[name]
    expect(runCase(pinned).violation?.invariant).toBe(expected)
    const control = runCase({ ...pinned, bugs: NO_BUGS, duration: pinned.duration + 3000 })
    expect(control.violation).toBeNull()
  })
})

describe('shrink', () => {
  it('respects its run budget', () => {
    const { found } = hunt({ bugs: onlyBug('commitPriorTerm'), seeds: BUDGET.commitPriorTerm })
    if (!found) throw new Error('expected a counterexample')
    const { shrunk, runs } = shrink(found, 3)
    expect(runs).toBeLessThanOrEqual(4) // three candidates plus the final duration trim
    expect(shrunk.violation.invariant).toBe(found.violation.invariant)
  })
})
