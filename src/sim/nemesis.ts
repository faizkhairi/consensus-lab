import type { Rng } from './rng'
import type { Action, NodeId, TimedAction } from './types'

export interface NemesisOptions {
  readonly duration: number
  readonly nodeCount: number
  /** Mean virtual ms between faults (gaps are exponentially distributed). */
  readonly meanGap?: number
}

/**
 * Generate a Jepsen-style fault schedule up front from a dedicated RNG stream.
 *
 * Every fault is self-contained (a crash carries its own restart delay, a
 * partition its own heal delay), so the shrinker can delete any subset of
 * faults and still have a valid schedule. Leader-targeted faults are resolved
 * at run time, which keeps them meaningful after shrinking.
 */
export function generateFaults(rng: Rng, options: NemesisOptions): TimedAction[] {
  const { duration, nodeCount } = options
  const meanGap = options.meanGap ?? 300
  const ids: NodeId[] = Array.from({ length: nodeCount }, (_, i) => i)
  const faults: TimedAction[] = []
  let t = rng.range(300, 700)
  while (t < duration) {
    if (rng.chance(0.15)) {
      // A flapping node: rapid crash/restart cycles, the classic trigger for lost-vote bugs.
      const node = rng.int(0, nodeCount - 1)
      const end = t + rng.range(200, 700)
      for (let at = t; at < end && at < duration; at += rng.range(15, 60)) {
        faults.push({
          at: Math.round(at),
          action: { type: 'crash', node, restartAfter: Math.round(rng.range(2, 20)) },
        })
      }
    } else {
      faults.push({ at: Math.round(t), action: pickFault(rng, ids) })
    }
    t += -Math.log(1 - rng.next()) * meanGap
  }
  return faults.sort((a, b) => a.at - b.at)
}

function pickFault(rng: Rng, ids: readonly NodeId[]): Action {
  const roll = rng.next()
  const n = ids.length
  if (roll < 0.25) return { type: 'crashLeader', restartAfter: Math.round(rng.range(10, 600)) }
  if (roll < 0.45)
    return { type: 'crash', node: rng.int(0, n - 1), restartAfter: Math.round(rng.range(10, 600)) }
  if (roll < 0.65) {
    return {
      type: 'isolateLeader',
      withFollowers: rng.int(0, Math.floor((n - 1) / 2)),
      healAfter: Math.round(rng.range(80, 900)),
    }
  }
  if (roll < 0.85) {
    const order = rng.shuffle([...ids])
    const cut = rng.int(1, n - 1)
    return {
      type: 'partition',
      groups: [order.slice(0, cut), order.slice(cut)],
      healAfter: Math.round(rng.range(80, 900)),
    }
  }
  return { type: 'dropRate', value: rng.pick([0, 0.05, 0.15, 0.3]) }
}

/** Short human description of a fault, for the UI and reports. */
export function describeAction(action: Action): string {
  const s = (id: NodeId) => `S${id + 1}`
  switch (action.type) {
    case 'crash':
      return `crash ${s(action.node)}${action.restartAfter !== undefined ? `, restart after ${action.restartAfter} ms` : ''}`
    case 'crashLeader':
      return `crash the leader${action.restartAfter !== undefined ? `, restart after ${action.restartAfter} ms` : ''}`
    case 'restart':
      return `restart ${s(action.node)}`
    case 'partition':
      return `partition ${action.groups.map((g) => `{${g.map(s).join(',')}}`).join(' | ')}${
        action.healAfter !== undefined ? `, heal after ${action.healAfter} ms` : ''
      }`
    case 'isolateLeader':
      return `isolate the leader${
        action.withFollowers > 0
          ? ` with ${action.withFollowers} follower${action.withFollowers > 1 ? 's' : ''}`
          : ''
      }${action.healAfter !== undefined ? `, heal after ${action.healAfter} ms` : ''}`
    case 'heal':
      return 'heal the network'
    case 'write':
      return action.target !== undefined ? `client write to ${s(action.target)}` : 'client write'
    case 'dropRate':
      return `set message loss to ${Math.round(action.value * 100)}%`
    case 'bugs':
      return 'change injected bugs'
  }
}
