import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Cluster } from '../src/sim/cluster'
import { fuzzConfig, interactiveConfig } from '../src/sim/config'
import type { Action, SimConfig, TimedAction } from '../src/sim/types'
import { fingerprint } from './helpers'

const NODES = [0, 1, 2, 3, 4]
const node = fc.integer({ min: 0, max: 4 })
const delay = fc.integer({ min: 1, max: 900 })

const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ type: fc.constant('crash' as const), node, restartAfter: delay }),
  fc.record({ type: fc.constant('crashLeader' as const), restartAfter: delay }),
  fc.record({ type: fc.constant('restart' as const), node }),
  fc.shuffledSubarray(NODES, { minLength: 1, maxLength: 4 }).chain((side) =>
    fc.record({
      type: fc.constant('partition' as const),
      groups: fc.constant([side, NODES.filter((n) => !side.includes(n))]),
      healAfter: delay,
    }),
  ),
  fc.record({
    type: fc.constant('isolateLeader' as const),
    withFollowers: fc.integer({ min: 0, max: 2 }),
    healAfter: delay,
  }),
  fc.constant({ type: 'heal' as const }),
  fc.record({ type: fc.constant('dropRate' as const), value: fc.double({ min: 0, max: 0.4, noNaN: true }) }),
  fc.record({ type: fc.constant('write' as const) }),
)

const schedule = fc.array(fc.record({ at: fc.integer({ min: 0, max: 5000 }), action }), { maxLength: 40 })
const seed = fc.integer({ min: 0, max: 0xffffffff })

function run(config: SimConfig, faults: readonly TimedAction[], until: number): Cluster {
  const cluster = new Cluster(config, { timed: faults, recordTrace: false, trackMessages: false })
  cluster.runUntil(until)
  return cluster
}

describe('properties over random fault schedules', () => {
  it('never violates a safety invariant (fuzzing profile)', () => {
    fc.assert(
      fc.property(seed, schedule, (s, faults) => {
        expect(run(fuzzConfig(s), faults, 6000).violation).toBeNull()
      }),
      { numRuns: 150 },
    )
  })

  it('never violates a safety invariant (interactive profile)', () => {
    fc.assert(
      fc.property(seed, schedule, (s, faults) => {
        expect(run(interactiveConfig(s), faults, 6000).violation).toBeNull()
      }),
      { numRuns: 150 },
    )
  })

  it('is deterministic for any seed and schedule', () => {
    fc.assert(
      fc.property(seed, schedule, (s, faults) => {
        const a = new Cluster(fuzzConfig(s), { timed: faults })
        const b = new Cluster(fuzzConfig(s), { timed: faults })
        a.runUntil(3000)
        b.runUntil(3000)
        expect(fingerprint(a)).toBe(fingerprint(b))
      }),
      { numRuns: 50 },
    )
  })

  it('recovers once the faults stop: a leader is elected and a new write commits everywhere', () => {
    fc.assert(
      fc.property(seed, schedule, (s, faults) => {
        const cluster = run(interactiveConfig(s), faults, 5000)
        cluster.act({ type: 'heal' })
        cluster.act({ type: 'dropRate', value: 0 })
        for (const id of NODES) cluster.act({ type: 'restart', node: id })
        cluster.runUntil(8000) // late restarts and heals from the schedule land in here
        cluster.act({ type: 'write' })
        cluster.runUntil(9000)
        const leader = cluster.leader
        expect(leader).not.toBeNull()
        expect(leader?.log.at(-1)?.cmd).toMatch(/^w\d+$/)
        for (const n of cluster.nodes) expect(n.commitIndex).toBe(leader?.log.length)
      }),
      { numRuns: 100 },
    )
  })
})
