import type { InvariantId, LogEntry, NodeId, Role, Violation } from './types'

/** The parts of a node the oracle reads. */
export interface ObservedNode {
  readonly id: NodeId
  readonly currentTerm: number
  readonly log: readonly LogEntry[]
}

export const INVARIANT_INFO: Record<InvariantId, { title: string; rule: string }> = {
  electionSafety: {
    title: 'Election Safety',
    rule: 'At most one leader can be elected in a given term.',
  },
  leaderAppendOnly: {
    title: 'Leader Append-Only',
    rule: 'A leader never overwrites or deletes entries in its log; it only appends.',
  },
  logMatching: {
    title: 'Log Matching',
    rule: 'If two logs contain an entry with the same index and term, the logs are identical up to that index.',
  },
  leaderCompleteness: {
    title: 'Leader Completeness',
    rule: 'If an entry is committed in a term, it is present in the log of every leader of later terms.',
  },
  stateMachineSafety: {
    title: 'State Machine Safety',
    rule: 'If a server applies an entry at an index, no server ever applies a different entry at that index.',
  },
}

const name = (id: NodeId) => `S${id + 1}`
const describe = (entry: LogEntry) => `${entry.cmd}@t${entry.term}`

const sameEntry = (a: LogEntry | undefined, b: LogEntry | undefined) =>
  a !== undefined && b !== undefined && a.term === b.term && a.cmd === b.cmd

/**
 * A global observer that checks the five safety properties from the Raft paper
 * (Figure 3) as the simulation runs. It sees every node, which no real node
 * can, and that global view is what makes it an oracle.
 */
export class Oracle {
  private readonly leaders = new Map<number, NodeId>()
  /** Every entry any node has ever declared committed, by index (index i at [i - 1]). */
  readonly committed: LogEntry[] = []
  readonly violations: Violation[] = []
  private readonly seen = new Set<InvariantId>()

  get first(): Violation | null {
    return this.violations[0] ?? null
  }

  onBecomeLeader(
    node: ObservedNode,
    time: number,
    eventIndex: number,
    logLength = node.log.length,
  ): Violation[] {
    const found: Violation[] = []
    const term = node.currentTerm
    const incumbent = this.leaders.get(term)
    if (incumbent !== undefined && incumbent !== node.id) {
      this.report(found, {
        invariant: 'electionSafety',
        time,
        eventIndex,
        nodes: [incumbent, node.id],
        message: `${name(incumbent)} and ${name(node.id)} were both elected leader of term ${term}.`,
      })
    } else {
      this.leaders.set(term, node.id)
    }
    for (let i = 1; i <= this.committed.length; i++) {
      const committed = this.committed[i - 1]
      if (committed === undefined) continue
      const has = i <= logLength ? node.log[i - 1] : undefined
      if (!sameEntry(has, committed)) {
        this.report(found, {
          invariant: 'leaderCompleteness',
          time,
          eventIndex,
          nodes: [node.id],
          index: i,
          message:
            `${name(node.id)} became leader of term ${term} without committed entry ` +
            `${describe(committed)} at index ${i}` +
            (has ? ` (it has ${describe(has)} there).` : ' (its log ends before that index).'),
        })
        break
      }
    }
    return found
  }

  onCommit(node: ObservedNode, from: number, to: number, time: number, eventIndex: number): Violation[] {
    const found: Violation[] = []
    for (let i = from + 1; i <= to; i++) {
      const entry = node.log[i - 1]
      // Committing past the end of the log is a simulator bug, not a Raft property; fail loudly.
      if (entry === undefined) throw new Error(`${name(node.id)} committed index ${i} beyond its log`)
      const known = this.committed[i - 1]
      if (known === undefined) {
        this.committed[i - 1] = entry
      } else if (!sameEntry(known, entry)) {
        this.report(found, {
          invariant: 'stateMachineSafety',
          time,
          eventIndex,
          nodes: [node.id],
          index: i,
          message:
            `${name(node.id)} committed ${describe(entry)} at index ${i}, ` +
            `but ${describe(known)} was already committed there.`,
        })
        break
      }
    }
    return found
  }

  onTruncate(node: ObservedNode, from: number, role: Role, time: number, eventIndex: number): Violation[] {
    const found: Violation[] = []
    if (role === 'leader') {
      this.report(found, {
        invariant: 'leaderAppendOnly',
        time,
        eventIndex,
        nodes: [node.id],
        index: from,
        message: `${name(node.id)} deleted entries from index ${from} while leader of term ${node.currentTerm}.`,
      })
    }
    return found
  }

  /** Compare the changed node's log against every other log. */
  checkLogMatching(
    changed: ObservedNode,
    all: readonly ObservedNode[],
    time: number,
    eventIndex: number,
  ): Violation[] {
    const found: Violation[] = []
    const a = changed.log
    for (const other of all) {
      if (other.id === changed.id) continue
      const b = other.log
      // Highest index where both logs hold an entry with the same term.
      let m = Math.min(a.length, b.length)
      while (m > 0 && a[m - 1]?.term !== b[m - 1]?.term) m--
      for (let j = m; j >= 1; j--) {
        if (!sameEntry(a[j - 1], b[j - 1])) {
          this.report(found, {
            invariant: 'logMatching',
            time,
            eventIndex,
            nodes: [changed.id, other.id],
            index: j,
            message:
              `${name(changed.id)} and ${name(other.id)} agree on term ${a[m - 1]?.term} at index ${m} ` +
              `but differ at index ${j}.`,
          })
          return found
        }
      }
    }
    return found
  }

  private report(found: Violation[], violation: Violation): void {
    if (this.seen.has(violation.invariant)) return
    this.seen.add(violation.invariant)
    this.violations.push(violation)
    found.push(violation)
  }
}
