import type { Rng } from './rng'
import type {
  AppendEntries,
  AppendEntriesReply,
  BugFlags,
  LogEntry,
  Message,
  NodeId,
  RaftConfig,
  RequestVote,
  RequestVoteReply,
  Role,
} from './types'

/**
 * Side effects a node asks the cluster to perform. Handlers never touch the
 * network, clock or scheduler directly; they return effects, which keeps the
 * node a deterministic state machine that is easy to test in isolation.
 */
export type Effect =
  | { readonly kind: 'send'; readonly to: NodeId; readonly msg: Message }
  | { readonly kind: 'electionTimer'; readonly at: number | null }
  | { readonly kind: 'heartbeatTimer'; readonly at: number | null }
  | { readonly kind: 'becameCandidate' }
  /** `logLength` is the log length at the moment of winning, before the term-start no-op. */
  | { readonly kind: 'becameLeader'; readonly logLength: number }
  | { readonly kind: 'steppedDown'; readonly from: Role }
  | { readonly kind: 'commit'; readonly from: number; readonly to: number }
  | { readonly kind: 'logAppended'; readonly from: number }
  | { readonly kind: 'logTruncated'; readonly from: number; readonly role: Role }

export class RaftNode {
  readonly id: NodeId
  readonly peers: readonly NodeId[]
  readonly clusterSize: number
  config: RaftConfig
  bugs: BugFlags
  private readonly rng: Rng

  // Persistent state (survives crashes).
  currentTerm = 0
  votedFor: NodeId | null = null
  log: LogEntry[] = []

  // Volatile state (lost on crash).
  alive = true
  role: Role = 'follower'
  leaderId: NodeId | null = null
  commitIndex = 0
  readonly votes = new Set<NodeId>()
  readonly nextIndex: number[]
  readonly matchIndex: number[]

  /** Election timer window, exposed for visualisation. */
  electionStart = 0
  electionDeadline = 0

  constructor(id: NodeId, clusterSize: number, config: RaftConfig, bugs: BugFlags, rng: Rng) {
    this.id = id
    this.clusterSize = clusterSize
    this.peers = Array.from({ length: clusterSize }, (_, i) => i).filter((i) => i !== id)
    this.config = config
    this.bugs = bugs
    this.rng = rng
    this.nextIndex = new Array<number>(clusterSize).fill(1)
    this.matchIndex = new Array<number>(clusterSize).fill(0)
  }

  get lastLogIndex(): number {
    return this.log.length
  }

  get lastLogTerm(): number {
    return this.termAt(this.log.length)
  }

  /** Term of the entry at a 1-based index; 0 for index 0, -1 past the end. */
  termAt(index: number): number {
    if (index <= 0) return 0
    return this.log[index - 1]?.term ?? -1
  }

  start(now: number): Effect[] {
    return [this.resetElectionTimer(now)]
  }

  crash(): void {
    this.alive = false
    this.role = 'follower'
    this.leaderId = null
    this.votes.clear()
  }

  restart(now: number): Effect[] {
    this.alive = true
    this.role = 'follower'
    this.leaderId = null
    this.commitIndex = 0
    this.votes.clear()
    // BUG forgetVoteOnRestart: votedFor was only held in memory, so it is lost.
    if (this.bugs.forgetVoteOnRestart) this.votedFor = null
    return [this.resetElectionTimer(now)]
  }

  onElectionTimeout(now: number): Effect[] {
    if (!this.alive || this.role === 'leader') return []
    const effects: Effect[] = []
    this.currentTerm += 1
    this.role = 'candidate'
    this.votedFor = this.id
    this.leaderId = null
    this.votes.clear()
    this.votes.add(this.id)
    effects.push({ kind: 'becameCandidate' }, this.resetElectionTimer(now))
    const request: RequestVote = {
      type: 'RequestVote',
      term: this.currentTerm,
      candidateId: this.id,
      lastLogIndex: this.lastLogIndex,
      lastLogTerm: this.lastLogTerm,
    }
    for (const peer of this.peers) effects.push({ kind: 'send', to: peer, msg: request })
    if (this.hasMajority(this.votes.size)) this.becomeLeader(now, effects)
    return effects
  }

  onHeartbeatTimeout(now: number): Effect[] {
    if (!this.alive || this.role !== 'leader') return []
    const effects: Effect[] = []
    for (const peer of this.peers) this.sendAppend(peer, effects)
    effects.push({ kind: 'heartbeatTimer', at: now + this.config.heartbeatInterval })
    return effects
  }

  /** Returns null when this node cannot accept writes (not the leader, or down). */
  onClientRequest(cmd: string): Effect[] | null {
    if (!this.alive || this.role !== 'leader') return null
    const effects: Effect[] = []
    this.appendLocal({ term: this.currentTerm, cmd }, effects)
    for (const peer of this.peers) this.sendAppend(peer, effects)
    this.advanceCommit(effects)
    return effects
  }

  onMessage(from: NodeId, msg: Message, now: number): Effect[] {
    if (!this.alive) return []
    const effects: Effect[] = []
    // Rules for all servers: a higher term always wins and demotes us to follower.
    if (msg.term > this.currentTerm) this.becomeFollower(msg.term, now, effects)
    switch (msg.type) {
      case 'RequestVote':
        this.handleRequestVote(msg, now, effects)
        break
      case 'RequestVoteReply':
        this.handleRequestVoteReply(from, msg, now, effects)
        break
      case 'AppendEntries':
        this.handleAppendEntries(msg, now, effects)
        break
      case 'AppendEntriesReply':
        this.handleAppendEntriesReply(from, msg, effects)
        break
    }
    return effects
  }

  private handleRequestVote(msg: RequestVote, now: number, effects: Effect[]): void {
    let granted = false
    if (msg.term === this.currentTerm && (this.votedFor === null || this.votedFor === msg.candidateId)) {
      const upToDate =
        msg.lastLogTerm > this.lastLogTerm ||
        (msg.lastLogTerm === this.lastLogTerm && msg.lastLogIndex >= this.lastLogIndex)
      // BUG skipUpToDateCheck: grant the vote without comparing logs (5.4.1).
      if (upToDate || this.bugs.skipUpToDateCheck) {
        this.votedFor = msg.candidateId
        granted = true
        effects.push(this.resetElectionTimer(now))
      }
    }
    const reply: RequestVoteReply = { type: 'RequestVoteReply', term: this.currentTerm, voteGranted: granted }
    effects.push({ kind: 'send', to: msg.candidateId, msg: reply })
  }

  private handleRequestVoteReply(from: NodeId, msg: RequestVoteReply, now: number, effects: Effect[]): void {
    if (this.role !== 'candidate' || msg.term !== this.currentTerm || !msg.voteGranted) return
    this.votes.add(from)
    if (this.hasMajority(this.votes.size)) this.becomeLeader(now, effects)
  }

  private handleAppendEntries(msg: AppendEntries, now: number, effects: Effect[]): void {
    if (msg.term < this.currentTerm) {
      this.reply(msg.leaderId, false, 0, 0, effects)
      return
    }
    // Same term: whoever sent this won the election, so candidates (and, only
    // when election safety is already broken by a bug, a rival leader) yield.
    if (this.role !== 'follower') this.becomeFollower(msg.term, now, effects)
    this.leaderId = msg.leaderId
    effects.push(this.resetElectionTimer(now))

    // Consistency check (5.3), with a conflict hint so the leader can skip back a whole term.
    if (msg.prevLogIndex > this.lastLogIndex) {
      this.reply(msg.leaderId, false, 0, this.lastLogIndex + 1, effects)
      return
    }
    if (this.termAt(msg.prevLogIndex) !== msg.prevLogTerm) {
      const conflictTerm = this.termAt(msg.prevLogIndex)
      let conflictIndex = msg.prevLogIndex
      while (conflictIndex > 1 && this.termAt(conflictIndex - 1) === conflictTerm) conflictIndex--
      this.reply(msg.leaderId, false, 0, conflictIndex, effects)
      return
    }

    let index = msg.prevLogIndex
    let appendedFrom = 0
    for (const entry of msg.entries) {
      index++
      if (index <= this.log.length) {
        if (this.termAt(index) === entry.term) continue // already have it (Log Matching)
        this.log.length = index - 1
        effects.push({ kind: 'logTruncated', from: index, role: this.role })
      }
      this.log.push(entry)
      if (appendedFrom === 0) appendedFrom = index
    }
    if (appendedFrom > 0) effects.push({ kind: 'logAppended', from: appendedFrom })

    const lastNewIndex = msg.prevLogIndex + msg.entries.length
    if (msg.leaderCommit > this.commitIndex) {
      const target = Math.min(msg.leaderCommit, lastNewIndex)
      if (target > this.commitIndex) this.commitTo(target, effects)
    }
    this.reply(msg.leaderId, true, lastNewIndex, 0, effects)
  }

  private handleAppendEntriesReply(from: NodeId, msg: AppendEntriesReply, effects: Effect[]): void {
    if (this.role !== 'leader' || msg.term !== this.currentTerm) return
    if (msg.success) {
      const previousMatch = this.matchIndex[from] ?? 0
      if (msg.matchIndex <= previousMatch) return // stale or duplicate reply: no progress
      this.matchIndex[from] = msg.matchIndex
      this.nextIndex[from] = Math.max(this.nextIndex[from] ?? 1, msg.matchIndex + 1)
      this.advanceCommit(effects)
      if ((this.nextIndex[from] ?? 1) <= this.lastLogIndex) this.sendAppend(from, effects)
      return
    }
    const floor = (this.matchIndex[from] ?? 0) + 1
    const next = Math.min((this.nextIndex[from] ?? 1) - 1, msg.conflictIndex)
    this.nextIndex[from] = Math.max(floor, next, 1)
    this.sendAppend(from, effects)
  }

  private becomeFollower(term: number, now: number, effects: Effect[]): void {
    if (term > this.currentTerm) {
      this.currentTerm = term
      this.votedFor = null
    }
    const previous = this.role
    if (previous === 'follower') return
    this.role = 'follower'
    this.votes.clear()
    effects.push({ kind: 'steppedDown', from: previous })
    if (previous === 'leader') {
      effects.push({ kind: 'heartbeatTimer', at: null }, this.resetElectionTimer(now))
    }
  }

  private becomeLeader(now: number, effects: Effect[]): void {
    this.role = 'leader'
    this.leaderId = this.id
    for (const peer of this.peers) {
      this.nextIndex[peer] = this.lastLogIndex + 1
      this.matchIndex[peer] = 0
    }
    effects.push({ kind: 'becameLeader', logLength: this.lastLogIndex }, { kind: 'electionTimer', at: null })
    // A no-op entry from the new term lets the leader commit earlier entries safely.
    this.appendLocal({ term: this.currentTerm, cmd: 'noop' }, effects)
    for (const peer of this.peers) this.sendAppend(peer, effects)
    effects.push({ kind: 'heartbeatTimer', at: now + this.config.heartbeatInterval })
    this.advanceCommit(effects)
  }

  private advanceCommit(effects: Effect[]): void {
    for (let n = this.lastLogIndex; n > this.commitIndex; n--) {
      // 5.4.2: only entries from the leader's current term are committed by counting replicas.
      // BUG commitPriorTerm: count replicas for older-term entries too (Figure 8).
      if (this.termAt(n) !== this.currentTerm && !this.bugs.commitPriorTerm) break
      let replicas = 1
      for (const peer of this.peers) if ((this.matchIndex[peer] ?? 0) >= n) replicas++
      if (this.hasMajority(replicas)) {
        this.commitTo(n, effects)
        return
      }
    }
  }

  private commitTo(index: number, effects: Effect[]): void {
    effects.push({ kind: 'commit', from: this.commitIndex, to: index })
    this.commitIndex = index
  }

  private appendLocal(entry: LogEntry, effects: Effect[]): void {
    this.log.push(entry)
    this.matchIndex[this.id] = this.log.length
    effects.push({ kind: 'logAppended', from: this.log.length })
  }

  private sendAppend(peer: NodeId, effects: Effect[]): void {
    const prevLogIndex = (this.nextIndex[peer] ?? 1) - 1
    const msg: AppendEntries = {
      type: 'AppendEntries',
      term: this.currentTerm,
      leaderId: this.id,
      prevLogIndex,
      prevLogTerm: this.termAt(prevLogIndex),
      entries: this.log.slice(prevLogIndex, prevLogIndex + this.config.maxEntriesPerAppend),
      leaderCommit: this.commitIndex,
    }
    effects.push({ kind: 'send', to: peer, msg })
  }

  private reply(
    to: NodeId,
    success: boolean,
    matchIndex: number,
    conflictIndex: number,
    effects: Effect[],
  ): void {
    const msg: AppendEntriesReply = {
      type: 'AppendEntriesReply',
      term: this.currentTerm,
      success,
      matchIndex,
      conflictIndex,
    }
    effects.push({ kind: 'send', to, msg })
  }

  private resetElectionTimer(now: number): Effect {
    const timeout = this.rng.range(this.config.electionTimeoutMin, this.config.electionTimeoutMax)
    this.electionStart = now
    this.electionDeadline = now + timeout
    return { kind: 'electionTimer', at: this.electionDeadline }
  }

  private hasMajority(count: number): boolean {
    return count * 2 > this.clusterSize
  }
}
