import type { Cluster } from '../src/sim/cluster'
import { hashString } from '../src/sim/rng'

/** A fingerprint of everything observable about a run: its trace and every node's state. */
export function fingerprint(cluster: Cluster): number {
  const nodes = cluster.nodes.map((n) => ({
    term: n.currentTerm,
    voted: n.votedFor,
    role: n.role,
    alive: n.alive,
    commit: n.commitIndex,
    log: n.log,
  }))
  return hashString(
    JSON.stringify({
      now: cluster.now,
      events: cluster.eventCount,
      trace: cluster.trace,
      nodes,
      stats: cluster.stats,
    }),
  )
}

export const logsOf = (cluster: Cluster) =>
  cluster.nodes.map((n) => n.log.map((e) => `${e.cmd}@${e.term}`).join(' '))
