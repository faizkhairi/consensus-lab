import type { Cluster } from '../sim/cluster'
import type { FuzzCase } from '../sim/fuzz'
import type { RaftNode } from '../sim/raft'
import { PINNED } from '../sim/scenarios'
import type { Session } from '../sim/session'
import { NO_BUGS } from '../sim/types'
import type { SimController } from './controller'

export type Panel = 'controls' | 'bugs' | 'fuzz'

export interface TourStep {
  readonly title: string
  readonly body: readonly string[]
  /** Side panel to show while this step is active. */
  readonly panel?: Panel
  /** Set up the step and start playback. Runs once each time the step is entered. */
  readonly enter: (ctl: SimController) => void
}

/** Seed for the guided tour: a clean first election and a partition that tells the story well. */
export const TOUR_SEED = 12

export const interactiveSession = (seed: number): Session => ({
  seed,
  mode: 'interactive',
  bugs: NO_BUGS,
  timed: [],
  recorded: [],
})

export const replaySession = (fuzzCase: FuzzCase): Session => ({
  seed: fuzzCase.seed,
  mode: 'fuzz',
  bugs: fuzzCase.bugs,
  timed: fuzzCase.faults,
  recorded: [],
})

const liveLogsMatch = (cluster: Cluster) => {
  const live = cluster.nodes.filter((n) => n.alive)
  const key = (n: RaftNode) => n.log.map((e) => `${e.term}:${e.cmd}`).join(',')
  return live.every((n) => key(n) === key(live[0] as RaftNode))
}

const allCommitted = (cluster: Cluster) => {
  const leader = cluster.leader
  if (!leader) return false
  return cluster.nodes.every((n) => !n.alive || n.commitIndex === leader.log.length)
}

export const TOUR: readonly TourStep[] = [
  {
    title: 'Leader election',
    body: [
      'Five servers start as followers. Each waits for a randomized election timeout, drawn as the ring around it.',
      'The first to time out becomes a candidate for term 1 and sends RequestVote to the others (amber dots). ' +
        'Three votes out of five make it leader.',
    ],
    panel: 'controls',
    enter: (ctl) => {
      ctl.load(interactiveSession(TOUR_SEED))
      ctl.setSpeed(1)
      ctl.playUntil((c) => c.leader !== null)
    },
  },
  {
    title: 'Log replication',
    body: [
      'A client sends three writes to the leader. The leader appends them to its log and replicates them with ' +
        'AppendEntries (blue dots).',
      'An entry is committed once a majority stores it; committed cells turn solid. Followers learn the new ' +
        'commit index from the next message.',
    ],
    enter: (ctl) => {
      for (let i = 0; i < 3; i++) ctl.act({ type: 'write' })
      ctl.playUntil((c) => allCommitted(c) && (c.leader?.log.length ?? 0) >= 4)
    },
  },
  {
    title: 'The leader crashes',
    body: [
      'Heartbeats stop. The first follower whose timer expires starts an election for a new term.',
      'The new leader appends a no-op entry in its own term. That is what lets it commit entries left over ' +
        'from earlier terms safely.',
    ],
    enter: (ctl) => {
      const old = ctl.cluster.leader
      ctl.act({ type: 'crashLeader' })
      const term = old?.currentTerm ?? 0
      ctl.playUntil((c) => (c.leader?.currentTerm ?? 0) > term)
    },
  },
  {
    title: 'A network partition',
    body: [
      'The crashed server comes back, then the network splits: the leader and one follower on one side, three ' +
        'servers on the other.',
      'The cut-off leader still accepts two writes, but it can only reach two of five servers, so they never ' +
        'commit. The majority side times out and elects a new leader in a higher term.',
    ],
    enter: (ctl) => {
      for (const node of ctl.cluster.nodes) if (!node.alive) ctl.act({ type: 'restart', node: node.id })
      const old = ctl.cluster.leader
      if (!old) return
      ctl.act({ type: 'isolateLeader', withFollowers: 1 })
      ctl.act({ type: 'write', target: old.id })
      ctl.act({ type: 'write', target: old.id })
      ctl.playUntil((c) => (c.leader?.currentTerm ?? 0) > old.currentTerm)
    },
  },
  {
    title: 'The majority carries on',
    body: [
      'Two writes sent to the new leader commit normally: three of five servers is still a majority.',
      'For a moment there are two leaders, in different terms. That is allowed. Election Safety only forbids ' +
        'two leaders in the same term.',
    ],
    enter: (ctl) => {
      ctl.act({ type: 'write' })
      ctl.act({ type: 'write' })
      const leader = ctl.cluster.leader
      const length = leader?.log.length ?? 0
      ctl.playUntil(() => leader !== null && leader.commitIndex >= length)
    },
  },
  {
    title: 'Healing the partition',
    body: [
      'When the network heals, the old leader hears the higher term and steps down.',
      'Its two uncommitted writes conflict with the new leader’s log and are overwritten. Nothing that was ' +
        'committed is lost, which is exactly what the oracle checks.',
    ],
    enter: (ctl) => {
      ctl.act({ type: 'heal' })
      ctl.playUntil((c) => c.nodes.filter((n) => n.role === 'leader').length === 1 && liveLogsMatch(c))
    },
  },
  {
    title: 'A subtle bug: Figure 8',
    body: [
      'This run has one bug switched on: the leader commits entries from earlier terms by counting replicas, ' +
        'which section 5.4.2 of the Raft paper forbids.',
      'S2 leads term 10 and commits old term-6 entries, although its own term-10 no-op has reached no other ' +
        'server. Then S5, whose log ends in term 8, wins term 13 without one of those committed entries. The ' +
        'oracle flags Leader Completeness the moment S5 is elected.',
    ],
    panel: 'bugs',
    enter: (ctl) => {
      const fuzzCase = PINNED.commitPriorTerm
      ctl.load(replaySession(fuzzCase), { time: 3100, horizon: fuzzCase.duration })
      ctl.setSpeed(1)
      ctl.play()
    },
  },
  {
    title: 'One crash, two leaders',
    body: [
      'Another bug: votedFor lives only in memory. S4 votes in term 2, crashes, restarts 5 ms later with no ' +
        'memory of that vote, and votes again for the rival candidate. S1 and S5 both win term 2.',
      'The fuzzer found this in a run with 83 faults and shrank it to this single crash.',
    ],
    panel: 'bugs',
    enter: (ctl) => {
      const fuzzCase = PINNED.forgetVoteOnRestart
      ctl.load(replaySession(fuzzCase), { time: 330, horizon: fuzzCase.duration })
      ctl.setSpeed(0.5)
      ctl.play()
    },
  },
  {
    title: 'Finding bugs without knowing where to look',
    body: [
      'Every run is a pure function of its seed and fault schedule, so any failure can be replayed exactly.',
      'The fuzzer runs thousands of seeds in a Web Worker, stops at the first violation, then shrinks the ' +
        'fault schedule with delta debugging to a minimal reproduction you can replay step by step. Pick a ' +
        'bug and press Hunt.',
    ],
    panel: 'fuzz',
    enter: (ctl) => {
      ctl.pause()
    },
  },
]
