import { describe, expect, it } from 'vitest'
import { describeAction, generateFaults } from '../src/sim/nemesis'
import { Rng } from '../src/sim/rng'
import { NO_BUGS } from '../src/sim/types'

describe('nemesis', () => {
  it('generates a sorted, in-range schedule deterministically', () => {
    const a = generateFaults(new Rng(4), { duration: 6000, nodeCount: 5 })
    const b = generateFaults(new Rng(4), { duration: 6000, nodeCount: 5 })
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    for (let i = 0; i < a.length; i++) {
      const fault = a[i]
      expect(fault?.at).toBeGreaterThanOrEqual(0)
      expect(fault?.at).toBeLessThan(6000)
      if (i > 0) expect(fault?.at).toBeGreaterThanOrEqual(a[i - 1]?.at ?? 0)
    }
  })

  it('uses every fault kind, including flapping nodes, across seeds', () => {
    const kinds = new Set<string>()
    let flapping = false
    for (let seed = 1; seed <= 200; seed++) {
      const faults = generateFaults(new Rng(seed), { duration: 6000, nodeCount: 5 })
      for (const f of faults) kinds.add(f.action.type)
      flapping ||= faults.some((f) => f.action.type === 'crash' && (f.action.restartAfter ?? 0) <= 20)
    }
    expect([...kinds].sort()).toEqual(['crash', 'crashLeader', 'dropRate', 'isolateLeader', 'partition'])
    expect(flapping).toBe(true)
  })

  it('describes every action in plain words', () => {
    expect(describeAction({ type: 'crash', node: 2, restartAfter: 40 })).toBe('crash S3, restart after 40 ms')
    expect(describeAction({ type: 'crash', node: 0 })).toBe('crash S1')
    expect(describeAction({ type: 'crashLeader', restartAfter: 10 })).toBe(
      'crash the leader, restart after 10 ms',
    )
    expect(describeAction({ type: 'crashLeader' })).toBe('crash the leader')
    expect(describeAction({ type: 'restart', node: 4 })).toBe('restart S5')
    expect(
      describeAction({
        type: 'partition',
        groups: [
          [0, 1],
          [2, 3, 4],
        ],
        healAfter: 90,
      }),
    ).toBe('partition {S1,S2} | {S3,S4,S5}, heal after 90 ms')
    expect(describeAction({ type: 'partition', groups: [[0]] })).toBe('partition {S1}')
    expect(describeAction({ type: 'isolateLeader', withFollowers: 1, healAfter: 5 })).toBe(
      'isolate the leader with 1 follower, heal after 5 ms',
    )
    expect(describeAction({ type: 'isolateLeader', withFollowers: 2 })).toBe(
      'isolate the leader with 2 followers',
    )
    expect(describeAction({ type: 'isolateLeader', withFollowers: 0 })).toBe('isolate the leader')
    expect(describeAction({ type: 'heal' })).toBe('heal the network')
    expect(describeAction({ type: 'write' })).toBe('client write')
    expect(describeAction({ type: 'write', target: 1 })).toBe('client write to S2')
    expect(describeAction({ type: 'dropRate', value: 0.15 })).toBe('set message loss to 15%')
    expect(describeAction({ type: 'bugs', bugs: NO_BUGS })).toBe('change injected bugs')
  })
})
