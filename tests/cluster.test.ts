import { describe, expect, it } from 'vitest'
import { Cluster } from '../src/sim/cluster'
import { interactiveConfig } from '../src/sim/config'
import { caseConfig } from '../src/sim/fuzz'
import type { RaftNode } from '../src/sim/raft'
import { onlyBug, PINNED } from '../src/sim/scenarios'
import { NO_BUGS } from '../src/sim/types'
import { fingerprint, logsOf } from './helpers'

function electedCluster(seed = 1): { cluster: Cluster; leader: RaftNode } {
  const cluster = new Cluster(interactiveConfig(seed))
  cluster.runUntil(1000)
  const leader = cluster.leader
  if (!leader) throw new Error(`seed ${seed}: no leader after 1000 ms`)
  return { cluster, leader }
}

describe('Cluster: normal operation', () => {
  it('elects exactly one leader and every node follows it', () => {
    const { cluster, leader } = electedCluster()
    expect(cluster.nodes.filter((n) => n.role === 'leader')).toHaveLength(1)
    for (const node of cluster.nodes) {
      expect(node.currentTerm).toBe(leader.currentTerm)
      expect(node.leaderId).toBe(leader.id)
    }
    expect(cluster.trace.some((t) => t.kind === 'elected')).toBe(true)
    expect(cluster.violation).toBeNull()
  })

  it('replicates and commits client writes on every node', () => {
    const { cluster, leader } = electedCluster()
    for (let i = 0; i < 3; i++) cluster.act({ type: 'write' })
    cluster.runUntil(cluster.now + 500)
    const logs = logsOf(cluster)
    expect(new Set(logs).size).toBe(1)
    expect(leader.log.map((e) => e.cmd)).toEqual(['noop', 'w1', 'w2', 'w3'])
    for (const node of cluster.nodes) expect(node.commitIndex).toBe(4)
    expect(cluster.stats.writes).toBe(3)
    expect(cluster.oracle.committed).toHaveLength(4)
  })

  it('rejects writes while there is no leader', () => {
    const cluster = new Cluster(interactiveConfig(1))
    cluster.act({ type: 'write' })
    expect(cluster.stats.rejectedWrites).toBe(1)
    expect(cluster.trace.at(-1)?.kind).toBe('writeRejected')
    // A write sent to a follower is rejected too.
    const { cluster: running, leader } = electedCluster()
    running.act({ type: 'write', target: (leader.id + 1) % 5 })
    expect(running.stats.rejectedWrites).toBe(1)
  })

  it('elects a new leader in a higher term after the leader crashes, keeping committed entries', () => {
    const { cluster, leader } = electedCluster()
    cluster.act({ type: 'write' })
    cluster.runUntil(cluster.now + 300)
    const committed = leader.log.slice(0, leader.commitIndex)
    cluster.act({ type: 'crashLeader', restartAfter: 400 })
    expect(leader.alive).toBe(false)
    cluster.runUntil(cluster.now + 1500)
    const next = cluster.leader
    expect(next).not.toBeNull()
    expect(next?.id).not.toBe(leader.id)
    expect(next?.currentTerm).toBeGreaterThan(leader.currentTerm - 1)
    expect(next?.log.slice(0, committed.length)).toEqual(committed)
    // The old leader restarted and caught up as a follower.
    expect(leader.alive).toBe(true)
    expect(leader.role).toBe('follower')
    expect(new Set(logsOf(cluster)).size).toBe(1)
    expect(cluster.violation).toBeNull()
  })

  it('keeps a minority leader from committing, then discards its entries when the partition heals', () => {
    const { cluster, leader: old } = electedCluster()
    const oldTerm = old.currentTerm
    cluster.act({ type: 'isolateLeader', withFollowers: 1 })
    cluster.act({ type: 'write', target: old.id })
    cluster.act({ type: 'write', target: old.id })
    cluster.runUntil(cluster.now + 1500)

    // Split brain, safely: the old leader still thinks it leads, but cannot commit.
    expect(old.role).toBe('leader')
    expect(old.log.map((e) => e.cmd)).toEqual(['noop', 'w1', 'w2'])
    expect(old.commitIndex).toBe(1)
    const fresh = cluster.leader as RaftNode
    expect(fresh.id).not.toBe(old.id)
    expect(fresh.currentTerm).toBeGreaterThan(oldTerm)

    cluster.act({ type: 'write' })
    cluster.runUntil(cluster.now + 500)
    expect(fresh.log.at(-1)?.cmd).toBe('w3')
    expect(fresh.commitIndex).toBe(fresh.log.length)

    cluster.act({ type: 'heal' })
    cluster.runUntil(cluster.now + 1000)
    expect(old.role).toBe('follower')
    expect(new Set(logsOf(cluster)).size).toBe(1)
    const cmds = old.log.map((e) => e.cmd)
    expect(cmds).toContain('w3')
    expect(cmds).not.toContain('w1')
    expect(cmds).not.toContain('w2')
    expect(cluster.trace.some((t) => t.kind === 'stepDown' && t.node === old.id)).toBe(true)
    expect(cluster.violation).toBeNull()
  })

  it('drops messages across a partition and to crashed nodes, with a reason', () => {
    const { cluster, leader } = electedCluster()
    const follower = (leader.id + 1) % 5
    cluster.act({ type: 'crash', node: follower })
    cluster.runUntil(cluster.now + 100)
    expect(cluster.recentDrops.at(-1)).toMatchObject({ reason: 'crashed', env: { to: follower } })

    cluster.act({ type: 'partition', groups: [[leader.id]] })
    expect(cluster.canReach(leader.id, follower)).toBe(false)
    expect(cluster.canReach(follower, (leader.id + 2) % 5)).toBe(true)
    cluster.runUntil(cluster.now + 100)
    expect(cluster.recentDrops.at(-1)?.reason).toBe('partition')
    for (const env of cluster.inFlight.values()) expect(env.deliverAt).toBeGreaterThan(cluster.now)
  })

  it('loses messages at the configured drop rate', () => {
    const { cluster } = electedCluster()
    cluster.act({ type: 'dropRate', value: 1 })
    const before = cluster.stats.delivered
    cluster.runUntil(cluster.now + 200) // anything in flight was already doomed or not
    const mid = cluster.stats.delivered
    cluster.runUntil(cluster.now + 500)
    expect(cluster.stats.delivered).toBe(mid)
    expect(mid).toBeGreaterThanOrEqual(before)
    expect(cluster.recentDrops.at(-1)?.reason).toBe('network')
    expect(cluster.trace.some((t) => t.kind === 'dropRate')).toBe(true)
  })

  it('treats no-op actions as no-ops', () => {
    const cluster = new Cluster(interactiveConfig(1))
    const before = fingerprint(cluster)
    cluster.act({ type: 'restart', node: 0 }) // already running
    cluster.act({ type: 'heal' }) // nothing to heal
    cluster.act({ type: 'crashLeader' }) // no leader yet
    cluster.act({ type: 'isolateLeader', withFollowers: 1 })
    expect(fingerprint(cluster)).toBe(before)
    cluster.act({ type: 'crash', node: 0 })
    const crashed = fingerprint(cluster)
    cluster.act({ type: 'crash', node: 0 })
    expect(fingerprint(cluster)).toBe(crashed)
  })

  it('switches injected bugs on every node mid-run', () => {
    const cluster = new Cluster(interactiveConfig(1))
    cluster.act({ type: 'bugs', bugs: onlyBug('commitPriorTerm') })
    expect(cluster.bugs.commitPriorTerm).toBe(true)
    for (const node of cluster.nodes) expect(node.bugs.commitPriorTerm).toBe(true)
  })

  it('tracks duplicated messages', () => {
    const config = interactiveConfig(3)
    const cluster = new Cluster({ ...config, network: { ...config.network, duplicateRate: 1 } })
    cluster.runUntil(600)
    expect(cluster.stats.sent).toBeGreaterThan(0)
    expect(cluster.stats.sent % 2).toBe(0)
    expect(cluster.violation).toBeNull()
  })
})

describe('Cluster: determinism and replay', () => {
  it('produces an identical run for the same seed and a different one for another seed', () => {
    const run = (seed: number) => {
      const cluster = new Cluster(interactiveConfig(seed))
      cluster.runUntil(3000)
      return fingerprint(cluster)
    }
    expect(run(7)).toBe(run(7))
    expect(run(7)).not.toBe(run(8))
  })

  it('replays recorded operator actions exactly, including ones taken between two events', () => {
    const original = new Cluster(interactiveConfig(5))
    original.runUntil(700)
    original.act({ type: 'write' })
    original.runUntil(900)
    original.act({ type: 'crash', node: 2, restartAfter: 150 })
    for (let i = 0; i < 17; i++) original.step()
    original.act({
      type: 'partition',
      groups: [
        [0, 1],
        [2, 3, 4],
      ],
      healAfter: 400,
    })
    original.act({ type: 'write' })
    original.runUntil(3000)

    const replay = new Cluster(interactiveConfig(5), { recorded: original.recorded })
    replay.runUntil(3000)
    expect(replay.recorded).toEqual(original.recorded)
    expect(fingerprint(replay)).toBe(fingerprint(original))
  })

  it('seeks to an exact position, even mid-timestamp', () => {
    const original = new Cluster(interactiveConfig(5))
    original.runUntil(800)
    for (let i = 0; i < 5; i++) original.step()
    original.act({ type: 'write' })
    const position = { eventCount: original.eventCount, now: original.now }
    const at = fingerprint(original)
    original.runUntil(2000)

    const copy = new Cluster(interactiveConfig(5), { recorded: original.recorded })
    copy.seek(position.eventCount, position.now)
    expect(fingerprint(copy)).toBe(at)
  })

  it('reaches the same verdict with tracing and message tracking off', () => {
    const fuzzCase = PINNED.commitPriorTerm
    const traced = new Cluster(caseConfig(fuzzCase), { timed: fuzzCase.faults })
    const lean = new Cluster(caseConfig(fuzzCase), {
      timed: fuzzCase.faults,
      recordTrace: false,
      trackMessages: false,
    })
    traced.runUntil(fuzzCase.duration)
    lean.runUntil(fuzzCase.duration)
    expect(lean.violation).toEqual(traced.violation)
    expect(lean.eventCount).toBe(traced.eventCount)
    expect(lean.trace.map((t) => t.kind)).toEqual(['violation'])
    expect(lean.inFlight.size).toBe(0)
  })

  it('stops at the first violation, or runs on past it when asked', () => {
    const fuzzCase = { ...PINNED.forgetVoteOnRestart, bugs: onlyBug('forgetVoteOnRestart') }
    const stopped = new Cluster(caseConfig(fuzzCase), { timed: fuzzCase.faults })
    stopped.runUntil(2000)
    expect(stopped.violation?.invariant).toBe('electionSafety')
    expect(stopped.now).toBeLessThan(500)

    const onward = new Cluster(caseConfig(fuzzCase), { timed: fuzzCase.faults })
    onward.runUntil(2000, false)
    expect(onward.now).toBe(2000)
    expect(onward.violation).toEqual(stopped.violation)

    const control = new Cluster(caseConfig({ ...fuzzCase, bugs: NO_BUGS }), { timed: fuzzCase.faults })
    control.runUntil(2000)
    expect(control.violation).toBeNull()
  })

  it('reports the next event time and returns false when the queue is empty', () => {
    const cluster = new Cluster(interactiveConfig(1))
    expect(cluster.nextEventTime).toBeGreaterThan(0)
    for (const node of cluster.nodes) cluster.act({ type: 'crash', node: node.id })
    // Only stale timers remain; they fire as no-ops and the queue drains.
    while (cluster.step()) {}
    expect(cluster.nextEventTime).toBeNull()
    expect(cluster.step()).toBe(false)
  })
})
