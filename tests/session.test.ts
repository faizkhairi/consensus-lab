import { describe, expect, it } from 'vitest'
import { PINNED } from '../src/sim/scenarios'
import {
  createCluster,
  decodeRun,
  encodeRun,
  isAction,
  type Session,
  sessionConfig,
} from '../src/sim/session'
import { NO_BUGS } from '../src/sim/types'

const pinned = PINNED.commitPriorTerm
const session: Session = {
  seed: pinned.seed,
  mode: 'fuzz',
  bugs: pinned.bugs,
  timed: pinned.faults,
  recorded: [{ afterEvents: 12, at: 150.5, action: { type: 'write', target: 2 } }],
}

const encodeJson = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('session', () => {
  it('picks the timing profile from the mode', () => {
    expect(sessionConfig(session).workload).not.toBeNull()
    expect(sessionConfig({ ...session, mode: 'interactive' }).workload).toBeNull()
    const cluster = createCluster(session, { recordTrace: false })
    cluster.runUntil(pinned.duration)
    expect(cluster.violation?.invariant).toBe('leaderCompleteness')
  })

  it('round-trips a run through a URL-safe string', () => {
    const encoded = encodeRun({ session, time: 1234.4 })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeRun(encoded)).toEqual({ session, time: 1234 })
    const plain = { ...session, bugs: NO_BUGS, timed: [], recorded: [] }
    expect(decodeRun(encodeRun({ session: plain, time: 0 }))?.session).toEqual(plain)
  })

  it('rejects malformed or hostile payloads instead of trusting them', () => {
    const valid = { v: 1, s: 1, m: 'interactive', b: [], ta: [], ra: [], t: 0 }
    expect(decodeRun(encodeJson(valid))).not.toBeNull()
    const bad: unknown[] = [
      null,
      [],
      { ...valid, v: 2 },
      { ...valid, s: -1 },
      { ...valid, s: 1.5 },
      { ...valid, m: 'chaos' },
      { ...valid, t: -5 },
      { ...valid, t: 'soon' },
      { ...valid, b: ['rmRf'] },
      { ...valid, b: 'commitPriorTerm' },
      { ...valid, ta: [{ at: 1, action: { type: 'crash', node: 9 } }] },
      { ...valid, ta: [{ at: -1, action: { type: 'heal' } }] },
      { ...valid, ta: {} },
      { ...valid, ra: [{ afterEvents: 1.5, at: 0, action: { type: 'heal' } }] },
      { ...valid, ra: [{ afterEvents: 1, at: 0, action: { type: 'dropRate', value: 2 } }] },
      { ...valid, ra: 'x' },
    ]
    for (const payload of bad) expect(decodeRun(encodeJson(payload))).toBeNull()
    expect(decodeRun('%%%not base64%%%')).toBeNull()
    expect(decodeRun(btoa('{not json'))).toBeNull()
  })

  it('validates every action shape', () => {
    const good = [
      { type: 'crash', node: 0, restartAfter: 10 },
      { type: 'crash', node: 4 },
      { type: 'restart', node: 1 },
      { type: 'crashLeader' },
      { type: 'partition', groups: [[0, 1], [2]], healAfter: 5 },
      { type: 'isolateLeader', withFollowers: 1 },
      { type: 'heal' },
      { type: 'write' },
      { type: 'write', target: 3 },
      { type: 'dropRate', value: 0.3 },
      { type: 'bugs', bugs: NO_BUGS },
    ]
    for (const action of good) expect(isAction(action)).toBe(true)
    const bad = [
      'crash',
      { type: 'explode' },
      { type: 'crash', node: 5 },
      { type: 'crash', node: 0, restartAfter: -1 },
      { type: 'restart' },
      { type: 'crashLeader', restartAfter: Number.NaN },
      { type: 'partition', groups: [[7]] },
      { type: 'partition', groups: 'all' },
      { type: 'isolateLeader', withFollowers: -1 },
      { type: 'write', target: 'leader' },
      { type: 'dropRate', value: -0.1 },
      { type: 'bugs', bugs: { commitPriorTerm: true } },
      { type: 'bugs', bugs: null },
    ]
    for (const action of bad) expect(isAction(action)).toBe(false)
  })
})
