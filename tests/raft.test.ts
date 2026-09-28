import { describe, expect, it } from 'vitest'
import { type Effect, RaftNode } from '../src/sim/raft'
import { Rng } from '../src/sim/rng'
import { onlyBug } from '../src/sim/scenarios'
import {
  type AppendEntries,
  type AppendEntriesReply,
  type BugFlags,
  type LogEntry,
  type Message,
  NO_BUGS,
  type RaftConfig,
  type RequestVote,
  type RequestVoteReply,
} from '../src/sim/types'

const CONFIG: RaftConfig = {
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  maxEntriesPerAppend: 4,
}

function makeNode(id = 0, bugs: BugFlags = NO_BUGS): RaftNode {
  return new RaftNode(id, 5, CONFIG, bugs, new Rng(id + 1))
}

function only<T extends Message['type']>(
  effects: readonly Effect[],
  type: T,
): Extract<Message, { type: T }>[] {
  const out: Extract<Message, { type: T }>[] = []
  for (const e of effects) {
    if (e.kind === 'send' && e.msg.type === type) out.push(e.msg as Extract<Message, { type: T }>)
  }
  return out
}

const vote = (term: number, voteGranted = true): RequestVoteReply => ({
  type: 'RequestVoteReply',
  term,
  voteGranted,
})

const requestVote = (term: number, candidateId: number, lastLogIndex = 0, lastLogTerm = 0): RequestVote => ({
  type: 'RequestVote',
  term,
  candidateId,
  lastLogIndex,
  lastLogTerm,
})

const append = (
  term: number,
  prevLogIndex: number,
  prevLogTerm: number,
  entries: LogEntry[],
  leaderCommit = 0,
): AppendEntries => ({
  type: 'AppendEntries',
  term,
  leaderId: 1,
  prevLogIndex,
  prevLogTerm,
  entries,
  leaderCommit,
})

const ok = (term: number, matchIndex: number): AppendEntriesReply => ({
  type: 'AppendEntriesReply',
  term,
  success: true,
  matchIndex,
  conflictIndex: 0,
})

const granted = (effects: readonly Effect[]) => only(effects, 'RequestVoteReply')[0]?.voteGranted

/** Node 0 times out and collects votes from nodes 1 and 2: a majority of five. */
function elect(node: RaftNode, now = 0): Effect[] {
  node.onElectionTimeout(now)
  node.onMessage(1, vote(node.currentTerm), now)
  return node.onMessage(2, vote(node.currentTerm), now)
}

describe('RaftNode: elections', () => {
  it('starts as a follower with an election deadline inside the configured window', () => {
    const node = makeNode()
    const [timer] = node.start(0)
    expect(node.role).toBe('follower')
    expect(timer).toMatchObject({ kind: 'electionTimer' })
    expect(node.electionDeadline).toBeGreaterThanOrEqual(150)
    expect(node.electionDeadline).toBeLessThan(300)
  })

  it('becomes a candidate on timeout: new term, votes for itself, asks every peer', () => {
    const node = makeNode()
    node.log = [{ term: 1, cmd: 'a' }]
    node.currentTerm = 1
    const effects = node.onElectionTimeout(100)
    expect(node.role).toBe('candidate')
    expect(node.currentTerm).toBe(2)
    expect(node.votedFor).toBe(0)
    const requests = only(effects, 'RequestVote')
    expect(requests).toHaveLength(4)
    expect(requests[0]).toMatchObject({ term: 2, candidateId: 0, lastLogIndex: 1, lastLogTerm: 1 })
    expect(effects.some((e) => e.kind === 'becameCandidate')).toBe(true)
  })

  it('wins with a majority, appends a no-op and starts heartbeats', () => {
    const node = makeNode()
    node.onElectionTimeout(0)
    expect(node.onMessage(1, vote(1), 0).some((e) => e.kind === 'becameLeader')).toBe(false)
    node.onMessage(1, vote(1), 0) // a duplicate vote from the same peer counts once
    expect(node.role).toBe('candidate')
    const effects = node.onMessage(2, vote(1), 0)
    expect(node.role).toBe('leader')
    expect(node.log).toEqual([{ term: 1, cmd: 'noop' }])
    expect(effects).toContainEqual({ kind: 'becameLeader', logLength: 0 })
    expect(effects).toContainEqual({ kind: 'electionTimer', at: null })
    expect(effects).toContainEqual({ kind: 'heartbeatTimer', at: 50 })
    expect(only(effects, 'AppendEntries')).toHaveLength(4)
  })

  it('ignores refused votes and votes from an old term', () => {
    const node = makeNode()
    node.onElectionTimeout(0)
    node.onElectionTimeout(300) // term 2
    node.onMessage(1, vote(1), 0)
    node.onMessage(2, vote(2, false), 0)
    node.onMessage(3, vote(2, false), 0)
    expect(node.role).toBe('candidate')
  })

  it('grants one vote per term', () => {
    const node = makeNode(4)
    expect(only(node.onMessage(0, requestVote(1, 0), 10), 'RequestVoteReply')[0]).toEqual({
      type: 'RequestVoteReply',
      term: 1,
      voteGranted: true,
    })
    expect(granted(node.onMessage(0, requestVote(1, 0), 11))).toBe(true)
    expect(granted(node.onMessage(1, requestVote(1, 1), 12))).toBe(false)
    // A new term clears the vote.
    expect(granted(node.onMessage(1, requestVote(2, 1), 13))).toBe(true)
  })

  it('rejects candidates from an older term and tells them the current term', () => {
    const node = makeNode(4)
    node.currentTerm = 5
    const reply = only(node.onMessage(0, requestVote(3, 0), 0), 'RequestVoteReply')[0]
    expect(reply).toEqual({ type: 'RequestVoteReply', term: 5, voteGranted: false })
  })

  it('only votes for candidates whose log is at least as up to date (5.4.1)', () => {
    const voter = () => {
      const node = makeNode(4)
      node.log = [
        { term: 1, cmd: 'a' },
        { term: 1, cmd: 'b' },
        { term: 2, cmd: 'c' },
      ]
      node.currentTerm = 2
      return node
    }
    const ask = (node: RaftNode, lastLogIndex: number, lastLogTerm: number) =>
      granted(node.onMessage(0, requestVote(3, 0, lastLogIndex, lastLogTerm), 0))

    expect(ask(voter(), 5, 1)).toBe(false) // longer, but an older last term
    expect(ask(voter(), 2, 2)).toBe(false) // same last term, shorter
    expect(ask(voter(), 3, 2)).toBe(true)
    expect(ask(voter(), 1, 3)).toBe(true) // a newer last term wins regardless of length

    const buggy = voter()
    buggy.bugs = onlyBug('skipUpToDateCheck')
    expect(ask(buggy, 0, 0)).toBe(true)
  })

  it('steps down from leader when it sees a higher term', () => {
    const node = makeNode()
    elect(node)
    const effects = node.onMessage(3, vote(7, false), 500)
    expect(node.role).toBe('follower')
    expect(node.currentTerm).toBe(7)
    expect(node.votedFor).toBeNull()
    expect(effects).toContainEqual({ kind: 'steppedDown', from: 'leader' })
    expect(effects).toContainEqual({ kind: 'heartbeatTimer', at: null })
    expect(effects.some((e) => e.kind === 'electionTimer' && e.at !== null)).toBe(true)
  })

  it('does nothing while leader (timeouts) or crashed (everything)', () => {
    const node = makeNode()
    elect(node)
    expect(node.onElectionTimeout(1000)).toEqual([])
    node.crash()
    expect(node.onElectionTimeout(1000)).toEqual([])
    expect(node.onHeartbeatTimeout(1000)).toEqual([])
    expect(node.onMessage(1, vote(9), 1000)).toEqual([])
    expect(node.onClientRequest('w1')).toBeNull()
  })
})

describe('RaftNode: persistence across restarts', () => {
  it('keeps term, vote and log, and forgets volatile state', () => {
    const node = makeNode(4)
    node.onMessage(0, requestVote(3, 0), 0)
    node.log = [{ term: 3, cmd: 'x' }]
    node.commitIndex = 1
    node.crash()
    expect(node.alive).toBe(false)
    node.restart(100)
    expect(node).toMatchObject({ alive: true, role: 'follower', currentTerm: 3, votedFor: 0, commitIndex: 0 })
    expect(node.log).toEqual([{ term: 3, cmd: 'x' }])
    expect(granted(node.onMessage(1, requestVote(3, 1), 101))).toBe(false)
  })

  it('with forgetVoteOnRestart, a restarted node votes twice in one term', () => {
    const node = makeNode(4, onlyBug('forgetVoteOnRestart'))
    node.onMessage(0, requestVote(3, 0), 0)
    node.crash()
    node.restart(5)
    expect(node.votedFor).toBeNull()
    expect(granted(node.onMessage(1, requestVote(3, 1), 6))).toBe(true)
  })
})

describe('RaftNode: AppendEntries on a follower', () => {
  it('rejects a leader from an older term', () => {
    const node = makeNode(4)
    node.currentTerm = 4
    const reply = only(node.onMessage(1, append(3, 0, 0, []), 0), 'AppendEntriesReply')[0]
    expect(reply).toMatchObject({ term: 4, success: false })
  })

  it('asks the leader to back up when its log is too short', () => {
    const node = makeNode(4)
    node.log = [{ term: 1, cmd: 'a' }]
    const reply = only(node.onMessage(1, append(1, 5, 1, []), 0), 'AppendEntriesReply')[0]
    expect(reply).toMatchObject({ success: false, conflictIndex: 2 })
  })

  it('skips back over a whole conflicting term (fast backtracking)', () => {
    const node = makeNode(4)
    node.log = [
      { term: 1, cmd: 'a' },
      { term: 2, cmd: 'b' },
      { term: 2, cmd: 'c' },
      { term: 2, cmd: 'd' },
    ]
    node.currentTerm = 2
    const reply = only(node.onMessage(1, append(3, 4, 3, []), 0), 'AppendEntriesReply')[0]
    expect(reply).toMatchObject({ success: false, conflictIndex: 2 })
  })

  it('appends new entries, is idempotent on redelivery and follows the leader commit', () => {
    const node = makeNode(4)
    const entries = [
      { term: 1, cmd: 'a' },
      { term: 1, cmd: 'b' },
    ]
    const first = node.onMessage(1, append(1, 0, 0, entries, 1), 0)
    expect(node.log).toEqual(entries)
    expect(first).toContainEqual({ kind: 'logAppended', from: 1 })
    expect(first).toContainEqual({ kind: 'commit', from: 0, to: 1 })
    expect(only(first, 'AppendEntriesReply')[0]).toMatchObject({ success: true, matchIndex: 2 })

    const again = node.onMessage(1, append(1, 0, 0, entries, 1), 1)
    expect(node.log).toEqual(entries)
    expect(again.some((e) => e.kind === 'logAppended' || e.kind === 'logTruncated')).toBe(false)
  })

  it('never commits past the entries this message has verified', () => {
    const node = makeNode(4)
    node.log = [
      { term: 1, cmd: 'a' },
      { term: 1, cmd: 'stale-1' },
      { term: 1, cmd: 'stale-2' },
    ]
    node.onMessage(1, append(2, 1, 1, [], 3), 0)
    expect(node.commitIndex).toBe(1)
  })

  it('truncates a conflicting suffix and replaces it', () => {
    const node = makeNode(4)
    node.log = [
      { term: 1, cmd: 'a' },
      { term: 2, cmd: 'lost' },
      { term: 2, cmd: 'lost-too' },
    ]
    node.currentTerm = 2
    const effects = node.onMessage(1, append(3, 1, 1, [{ term: 3, cmd: 'b' }]), 0)
    expect(node.log).toEqual([
      { term: 1, cmd: 'a' },
      { term: 3, cmd: 'b' },
    ])
    expect(effects).toContainEqual({ kind: 'logTruncated', from: 2, role: 'follower' })
  })

  it('makes a rival leader of the same term step down before its log is truncated', () => {
    // Only reachable once election safety is broken, but it is why Leader
    // Append-Only holds: truncation always happens as a follower.
    const node = makeNode(0)
    node.log = [{ term: 1, cmd: 'a' }]
    node.currentTerm = 1
    elect(node)
    expect(node.role).toBe('leader')
    const effects = node.onMessage(
      1,
      append(2, 1, 1, [
        { term: 1, cmd: 'b' },
        { term: 2, cmd: 'c' },
      ]),
      0,
    )
    const steppedDown = effects.findIndex((e) => e.kind === 'steppedDown')
    const truncated = effects.findIndex((e) => e.kind === 'logTruncated')
    expect(effects[steppedDown]).toEqual({ kind: 'steppedDown', from: 'leader' })
    expect(effects[truncated]).toEqual({ kind: 'logTruncated', from: 2, role: 'follower' })
    expect(steppedDown).toBeLessThan(truncated)
    expect(node.role).toBe('follower')
    expect(node.log.map((e) => e.cmd)).toEqual(['a', 'b', 'c'])
  })

  it('makes a candidate of the same term step down', () => {
    const node = makeNode(4)
    node.onElectionTimeout(0)
    const effects = node.onMessage(1, append(1, 0, 0, []), 10)
    expect(node.role).toBe('follower')
    expect(node.leaderId).toBe(1)
    expect(effects).toContainEqual({ kind: 'steppedDown', from: 'candidate' })
  })
})

describe('RaftNode: replication and commit on the leader', () => {
  it('replicates a client write and commits it once a majority has it', () => {
    const node = makeNode()
    elect(node)
    expect(node.onClientRequest('w1')).not.toBeNull()
    expect(node.log.map((e) => e.cmd)).toEqual(['noop', 'w1'])
    expect(node.commitIndex).toBe(0)
    node.onMessage(1, ok(1, 2), 10)
    expect(node.commitIndex).toBe(0)
    const commit = node.onMessage(2, ok(1, 2), 11)
    expect(commit).toContainEqual({ kind: 'commit', from: 0, to: 2 })
    expect(node.commitIndex).toBe(2)
  })

  it('ignores stale and duplicate success replies', () => {
    const node = makeNode()
    elect(node)
    node.onMessage(1, ok(1, 1), 10)
    expect(node.onMessage(1, ok(1, 1), 11)).toEqual([])
    expect(node.onMessage(1, ok(1, 0), 12)).toEqual([])
    expect(node.matchIndex[1]).toBe(1)
  })

  it('backs nextIndex up to the conflict hint and resends', () => {
    const node = makeNode()
    node.log = [
      { term: 1, cmd: 'a' },
      { term: 1, cmd: 'b' },
      { term: 1, cmd: 'c' },
    ]
    node.currentTerm = 1
    elect(node)
    expect(node.nextIndex[3]).toBe(4)
    const reply: AppendEntriesReply = {
      type: 'AppendEntriesReply',
      term: 2,
      success: false,
      matchIndex: 0,
      conflictIndex: 2,
    }
    const effects = node.onMessage(3, reply, 20)
    expect(node.nextIndex[3]).toBe(2)
    expect(only(effects, 'AppendEntries')[0]).toMatchObject({ prevLogIndex: 1, prevLogTerm: 1 })
  })

  it('sends heartbeats to every peer and reschedules itself', () => {
    const node = makeNode()
    elect(node)
    const effects = node.onHeartbeatTimeout(50)
    expect(only(effects, 'AppendEntries')).toHaveLength(4)
    expect(effects).toContainEqual({ kind: 'heartbeatTimer', at: 100 })
    expect(makeNode(3).onHeartbeatTimeout(50)).toEqual([])
  })

  it('does not commit an earlier-term entry by counting replicas (5.4.2)', () => {
    const setup = (bugs: BugFlags) => {
      const node = makeNode(0, bugs)
      node.log = [{ term: 2, cmd: 'old' }]
      node.currentTerm = 2
      elect(node) // term 3, no-op at index 2
      node.onMessage(1, ok(3, 1), 10)
      node.onMessage(2, ok(3, 1), 10)
      return node
    }
    // The term-2 entry sits on three of five nodes, but only the current term may be counted.
    const correct = setup(NO_BUGS)
    expect(correct.commitIndex).toBe(0)
    correct.onMessage(1, ok(3, 2), 20)
    correct.onMessage(2, ok(3, 2), 20)
    expect(correct.commitIndex).toBe(2) // committing the no-op commits everything before it

    const buggy = setup(onlyBug('commitPriorTerm'))
    expect(buggy.commitIndex).toBe(1)
  })
})
