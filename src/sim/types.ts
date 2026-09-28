export type NodeId = number
export type Role = 'follower' | 'candidate' | 'leader'

/** A log entry. `cmd` is unique per client write ("w12") or "noop" for a leader's term-start entry. */
export interface LogEntry {
  readonly term: number
  readonly cmd: string
}

export interface RequestVote {
  readonly type: 'RequestVote'
  readonly term: number
  readonly candidateId: NodeId
  readonly lastLogIndex: number
  readonly lastLogTerm: number
}

export interface RequestVoteReply {
  readonly type: 'RequestVoteReply'
  readonly term: number
  readonly voteGranted: boolean
}

export interface AppendEntries {
  readonly type: 'AppendEntries'
  readonly term: number
  readonly leaderId: NodeId
  readonly prevLogIndex: number
  readonly prevLogTerm: number
  readonly entries: readonly LogEntry[]
  readonly leaderCommit: number
}

export interface AppendEntriesReply {
  readonly type: 'AppendEntriesReply'
  readonly term: number
  readonly success: boolean
  /** On success: highest index known to match the leader. */
  readonly matchIndex: number
  /** On failure: where the leader should retry from (fast log backtracking). */
  readonly conflictIndex: number
}

export type Message = RequestVote | RequestVoteReply | AppendEntries | AppendEntriesReply
export type MessageType = Message['type']

export interface Envelope {
  readonly id: number
  readonly from: NodeId
  readonly to: NodeId
  readonly sentAt: number
  readonly deliverAt: number
  readonly msg: Message
}

export interface RaftConfig {
  readonly electionTimeoutMin: number
  readonly electionTimeoutMax: number
  readonly heartbeatInterval: number
  /** Cap on entries per AppendEntries; small values make lagging followers catch up in chunks. */
  readonly maxEntriesPerAppend: number
}

export interface NetworkConfig {
  readonly latencyMin: number
  readonly latencyMax: number
  readonly dropRate: number
  readonly duplicateRate: number
}

/** Deliberate, well-known Raft implementation bugs that can be switched on. */
export interface BugFlags {
  /** Figure 8: the leader commits an entry from an earlier term once it is on a majority. */
  readonly commitPriorTerm: boolean
  /** votedFor is kept in memory only, so a restarted node can vote twice in one term. */
  readonly forgetVoteOnRestart: boolean
  /** Voters skip the "candidate log at least as up-to-date" check. */
  readonly skipUpToDateCheck: boolean
}

export const NO_BUGS: BugFlags = Object.freeze({
  commitPriorTerm: false,
  forgetVoteOnRestart: false,
  skipUpToDateCheck: false,
})

export type BugName = keyof BugFlags
export const BUG_NAMES: readonly BugName[] = ['commitPriorTerm', 'forgetVoteOnRestart', 'skipUpToDateCheck']

export interface WorkloadConfig {
  /** Client writes arrive every [min, max] virtual ms; null disables the automatic workload. */
  readonly intervalMin: number
  readonly intervalMax: number
}

export interface SimConfig {
  readonly seed: number
  readonly nodeCount: number
  readonly raft: RaftConfig
  readonly network: NetworkConfig
  readonly bugs: BugFlags
  readonly workload: WorkloadConfig | null
}

/** Something that happens to the cluster from outside: operator, nemesis or client. */
export type Action =
  | { readonly type: 'crash'; readonly node: NodeId; readonly restartAfter?: number }
  | { readonly type: 'restart'; readonly node: NodeId }
  | { readonly type: 'crashLeader'; readonly restartAfter?: number }
  | {
      readonly type: 'partition'
      readonly groups: readonly (readonly NodeId[])[]
      readonly healAfter?: number
    }
  | { readonly type: 'isolateLeader'; readonly withFollowers: number; readonly healAfter?: number }
  | { readonly type: 'heal' }
  | { readonly type: 'write'; readonly target?: NodeId }
  | { readonly type: 'dropRate'; readonly value: number }
  | { readonly type: 'bugs'; readonly bugs: BugFlags }

/** An action fired by the scheduler at a virtual time (nemesis faults, scripted scenarios). */
export interface TimedAction {
  readonly at: number
  readonly action: Action
}

/** An operator action recorded against the number of events processed, so replay is exact. */
export interface RecordedAction {
  readonly afterEvents: number
  readonly at: number
  readonly action: Action
}

export type InvariantId =
  | 'electionSafety'
  | 'leaderAppendOnly'
  | 'logMatching'
  | 'leaderCompleteness'
  | 'stateMachineSafety'

export const INVARIANT_IDS: readonly InvariantId[] = [
  'electionSafety',
  'leaderAppendOnly',
  'logMatching',
  'leaderCompleteness',
  'stateMachineSafety',
]

export interface Violation {
  readonly invariant: InvariantId
  readonly time: number
  readonly eventIndex: number
  readonly message: string
  readonly nodes: readonly NodeId[]
  readonly index?: number
}

export type TraceKind =
  | 'elected'
  | 'candidate'
  | 'crash'
  | 'restart'
  | 'partition'
  | 'heal'
  | 'write'
  | 'writeRejected'
  | 'commit'
  | 'stepDown'
  | 'violation'
  | 'bugs'
  | 'dropRate'

export interface TraceEvent {
  readonly time: number
  readonly eventIndex: number
  readonly kind: TraceKind
  readonly node?: NodeId
  readonly term?: number
  readonly detail: string
}
