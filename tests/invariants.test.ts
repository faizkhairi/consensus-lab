import { describe, expect, it } from 'vitest'
import { INVARIANT_INFO, type ObservedNode, Oracle } from '../src/sim/invariants'
import { INVARIANT_IDS, type LogEntry } from '../src/sim/types'

const node = (id: number, currentTerm: number, log: LogEntry[] = []): ObservedNode => ({
  id,
  currentTerm,
  log,
})
const e = (term: number, cmd: string): LogEntry => ({ term, cmd })

// Positive controls: each check must fire on a hand-built bad state, or a
// clean fuzz run proves nothing. The negatives guard against false alarms.
describe('Oracle', () => {
  it('describes every invariant', () => {
    for (const id of INVARIANT_IDS) expect(INVARIANT_INFO[id].title.length).toBeGreaterThan(0)
  })

  it('Election Safety fires when two nodes lead the same term', () => {
    const oracle = new Oracle()
    expect(oracle.onBecomeLeader(node(0, 3), 10, 1)).toEqual([])
    expect(oracle.onBecomeLeader(node(1, 4), 20, 2)).toEqual([])
    const [v] = oracle.onBecomeLeader(node(2, 3), 30, 3)
    expect(v).toMatchObject({ invariant: 'electionSafety', nodes: [0, 2], time: 30, eventIndex: 3 })
    expect(v?.message).toBe('S1 and S3 were both elected leader of term 3.')
  })

  it('Leader Completeness fires when a new leader lacks a committed entry', () => {
    const oracle = new Oracle()
    oracle.onCommit(node(0, 1, [e(1, 'a'), e(1, 'b')]), 0, 2, 5, 1)
    expect(oracle.onBecomeLeader(node(1, 2, [e(1, 'a'), e(1, 'b')]), 6, 2)).toEqual([])

    const short = new Oracle()
    short.onCommit(node(0, 1, [e(1, 'a'), e(1, 'b')]), 0, 2, 5, 1)
    const [missing] = short.onBecomeLeader(node(1, 2, [e(1, 'a')]), 6, 2)
    expect(missing).toMatchObject({ invariant: 'leaderCompleteness', index: 2 })
    expect(missing?.message).toContain('its log ends before that index')

    const different = new Oracle()
    different.onCommit(node(0, 1, [e(1, 'a')]), 0, 1, 5, 1)
    const [replaced] = different.onBecomeLeader(node(1, 2, [e(2, 'x')]), 6, 2)
    expect(replaced?.message).toContain('it has x@t2 there')
  })

  it('Leader Completeness checks the log as it was when the election was won', () => {
    const oracle = new Oracle()
    oracle.onCommit(node(0, 1, [e(1, 'a')]), 0, 1, 5, 1)
    // The node's log already holds its new no-op; logLength says it won with an empty log.
    const [v] = oracle.onBecomeLeader(node(1, 2, [e(2, 'noop')]), 6, 2, 0)
    expect(v).toMatchObject({ invariant: 'leaderCompleteness', index: 1 })
  })

  it('State Machine Safety fires when two different entries commit at one index', () => {
    const oracle = new Oracle()
    expect(oracle.onCommit(node(0, 1, [e(1, 'a')]), 0, 1, 5, 1)).toEqual([])
    expect(oracle.onCommit(node(1, 1, [e(1, 'a')]), 0, 1, 6, 2)).toEqual([])
    const [v] = oracle.onCommit(node(2, 2, [e(2, 'b')]), 0, 1, 7, 3)
    expect(v).toMatchObject({ invariant: 'stateMachineSafety', index: 1, nodes: [2] })
    expect(oracle.committed).toEqual([e(1, 'a')])
  })

  it('refuses a commit past the end of the log instead of skipping it', () => {
    const oracle = new Oracle()
    expect(() => oracle.onCommit(node(0, 1, [e(1, 'a')]), 0, 2, 5, 1)).toThrow(
      'S1 committed index 2 beyond its log',
    )
  })

  it('Leader Append-Only fires when a leader deletes entries, not when a follower does', () => {
    const oracle = new Oracle()
    expect(oracle.onTruncate(node(0, 2), 3, 'follower', 5, 1)).toEqual([])
    const [v] = oracle.onTruncate(node(0, 2), 3, 'leader', 6, 2)
    expect(v).toMatchObject({ invariant: 'leaderAppendOnly', index: 3 })
  })

  it('Log Matching fires when logs agree on a term at an index but differ earlier', () => {
    const oracle = new Oracle()
    const a = node(0, 2, [e(1, 'a'), e(2, 'b')])
    const agree = node(1, 2, [e(1, 'a'), e(2, 'b'), e(2, 'c')])
    const diverged = node(2, 3, [e(1, 'a'), e(3, 'z')]) // different term at index 2: allowed
    expect(oracle.checkLogMatching(a, [a, agree, diverged], 5, 1)).toEqual([])

    const bad = node(3, 2, [e(1, 'x'), e(2, 'b')])
    const [v] = oracle.checkLogMatching(a, [a, bad], 6, 2)
    expect(v).toMatchObject({ invariant: 'logMatching', index: 1, nodes: [0, 3] })
  })

  it('reports each invariant once and keeps the first violation', () => {
    const oracle = new Oracle()
    oracle.onBecomeLeader(node(0, 1), 1, 1)
    oracle.onBecomeLeader(node(1, 1), 2, 2)
    expect(oracle.onBecomeLeader(node(2, 1), 3, 3)).toEqual([])
    oracle.onTruncate(node(0, 1), 1, 'leader', 4, 4)
    expect(oracle.violations.map((v) => v.invariant)).toEqual(['electionSafety', 'leaderAppendOnly'])
    expect(oracle.first?.time).toBe(2)
  })
})
