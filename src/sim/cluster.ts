import { MinHeap } from './heap'
import { Oracle } from './invariants'
import { type Effect, RaftNode } from './raft'
import { Rng } from './rng'
import type {
  Action,
  BugFlags,
  Envelope,
  Message,
  NodeId,
  RecordedAction,
  SimConfig,
  TimedAction,
  TraceEvent,
  TraceKind,
  Violation,
} from './types'

type TimerKind = 'election' | 'heartbeat'

type Scheduled =
  | {
      readonly time: number
      readonly seq: number
      readonly kind: 'deliver'
      readonly env: Envelope
      readonly doomed: boolean
    }
  | {
      readonly time: number
      readonly seq: number
      readonly kind: 'timer'
      readonly node: NodeId
      readonly timer: TimerKind
      readonly gen: number
    }
  | { readonly time: number; readonly seq: number; readonly kind: 'action'; readonly action: Action }
  | { readonly time: number; readonly seq: number; readonly kind: 'workload' }

type Unsequenced = Scheduled extends infer S ? (S extends Scheduled ? Omit<S, 'seq'> : never) : never

export interface DroppedMessage {
  readonly env: Envelope
  readonly time: number
  readonly reason: 'network' | 'partition' | 'crashed'
}

export interface ClusterOptions {
  /** Actions fired by the scheduler at fixed virtual times (nemesis, scripted scenarios). */
  readonly timed?: readonly TimedAction[]
  /** Operator actions to replay, keyed by event count. */
  readonly recorded?: readonly RecordedAction[]
  /** Keep a trace for the timeline. Off while fuzzing, for speed. */
  readonly recordTrace?: boolean
  /** Keep in-flight and recently dropped messages for rendering. */
  readonly trackMessages?: boolean
}

const name = (id: NodeId) => `S${id + 1}`

/**
 * A discrete-event simulation of a Raft cluster.
 *
 * There is no wall clock. `now` is virtual time that jumps from one scheduled
 * event to the next, events at equal times are ordered by a sequence number,
 * and all randomness comes from seeded streams. Given the same config and
 * inputs, two clusters process byte-identical event sequences.
 */
export class Cluster {
  readonly config: SimConfig
  readonly nodes: RaftNode[]
  readonly oracle = new Oracle()
  readonly trace: TraceEvent[] = []
  readonly inFlight = new Map<number, Envelope>()
  readonly recentDrops: DroppedMessage[] = []
  readonly recorded: RecordedAction[] = []
  readonly stats = { sent: 0, delivered: 0, dropped: 0, writes: 0, rejectedWrites: 0 }

  now = 0
  eventCount = 0
  /** Virtual time of the most recently processed event. */
  lastEventTime = 0
  bugs: BugFlags
  dropRate: number
  /** Partition group per node, or null when the network is whole. */
  partition: number[] | null = null

  private readonly queue = new MinHeap<Scheduled>(
    (a, b) => a.time < b.time || (a.time === b.time && a.seq < b.seq),
  )
  private seq = 0
  private msgSeq = 0
  private writeSeq = 0
  /** One stream per directed link, so traffic on one link cannot shift randomness on another. */
  private readonly linkRng: Rng[]
  private readonly chaosRng: Rng
  private readonly workloadRng: Rng
  private readonly timerGen: Record<TimerKind, number[]>
  private readonly pending: RecordedAction[]
  private pendingIndex = 0
  private readonly recordTrace: boolean
  private readonly trackMessages: boolean

  constructor(config: SimConfig, options: ClusterOptions = {}) {
    this.config = config
    this.bugs = config.bugs
    this.dropRate = config.network.dropRate
    this.recordTrace = options.recordTrace ?? true
    this.trackMessages = options.trackMessages ?? true
    this.pending = [...(options.recorded ?? [])].sort((a, b) => a.afterEvents - b.afterEvents)

    const root = new Rng(config.seed)
    this.linkRng = Array.from({ length: config.nodeCount * config.nodeCount }, (_, i) =>
      root.fork(`link:${Math.floor(i / config.nodeCount)}:${i % config.nodeCount}`),
    )
    this.chaosRng = root.fork('chaos')
    this.workloadRng = root.fork('workload')
    this.nodes = Array.from(
      { length: config.nodeCount },
      (_, id) => new RaftNode(id, config.nodeCount, config.raft, config.bugs, root.fork(`node:${id}`)),
    )
    this.timerGen = {
      election: new Array<number>(config.nodeCount).fill(0),
      heartbeat: new Array<number>(config.nodeCount).fill(0),
    }

    for (const node of this.nodes) this.applyEffects(node, node.start(0))
    for (const timed of options.timed ?? [])
      this.schedule({ time: timed.at, kind: 'action', action: timed.action })
    if (config.workload) this.scheduleWorkload()
  }

  get violation(): Violation | null {
    return this.oracle.first
  }

  /** The node clients talk to: the live leader with the highest term. */
  get leader(): RaftNode | null {
    let best: RaftNode | null = null
    for (const node of this.nodes) {
      if (node.alive && node.role === 'leader' && (best === null || node.currentTerm > best.currentTerm))
        best = node
    }
    return best
  }

  /** Virtual time of the next scheduled event, if any. */
  get nextEventTime(): number | null {
    return this.queue.peek()?.time ?? null
  }

  canReach(a: NodeId, b: NodeId): boolean {
    return this.partition === null || this.partition[a] === this.partition[b]
  }

  /** Process exactly one event. Returns false when nothing is scheduled. */
  step(): boolean {
    const next = this.queue.peek()
    if (next === undefined) return false
    this.flushPending(next.time)
    const event = this.queue.pop() as Scheduled
    this.now = event.time
    this.lastEventTime = event.time
    this.eventCount++
    this.handle(event)
    return true
  }

  /** Advance virtual time to `time`, processing every event scheduled up to it. */
  runUntil(time: number, stopOnViolation = true): void {
    for (;;) {
      if (stopOnViolation && this.violation) return
      const next = this.queue.peek()
      if (next === undefined || next.time > time) break
      this.step()
    }
    this.flushPending(time)
    if (time > this.now) this.now = time
  }

  /**
   * Replay to an exact position: `eventCount` events processed and the clock
   * at `time`. Positions are counted in events, not time, because a run can
   * be paused between two events that share a timestamp. With
   * `advanceClock` false, recorded actions up to `time` are still replayed
   * but the clock stops at the last event or action instead of at `time`.
   */
  seek(eventCount: number, time: number, advanceClock = true): void {
    while (this.eventCount < eventCount && this.step()) {}
    this.flushPending(time)
    if (advanceClock && time > this.now) this.now = time
  }

  /** Apply an operator action now and record it so the run can be replayed exactly. */
  act(action: Action): void {
    this.recorded.push({ afterEvents: this.eventCount, at: this.now, action })
    this.applyAction(action)
  }

  private flushPending(limit: number): void {
    for (;;) {
      const next = this.pending[this.pendingIndex]
      if (next === undefined || next.afterEvents > this.eventCount || next.at > limit) return
      this.pendingIndex++
      if (next.at > this.now) this.now = next.at
      this.recorded.push(next)
      this.applyAction(next.action)
    }
  }

  private schedule(event: Unsequenced): void {
    this.queue.push({ ...event, seq: this.seq++ })
  }

  private scheduleWorkload(): void {
    const w = this.config.workload
    if (!w) return
    this.schedule({ time: this.now + this.workloadRng.range(w.intervalMin, w.intervalMax), kind: 'workload' })
  }

  private handle(event: Scheduled): void {
    switch (event.kind) {
      case 'deliver':
        this.deliver(event.env, event.doomed)
        break
      case 'timer': {
        if (this.timerGen[event.timer][event.node] !== event.gen) return
        const node = this.nodes[event.node] as RaftNode
        const effects =
          event.timer === 'election' ? node.onElectionTimeout(this.now) : node.onHeartbeatTimeout(this.now)
        this.applyEffects(node, effects)
        break
      }
      case 'action':
        this.applyAction(event.action)
        break
      case 'workload':
        this.applyAction({ type: 'write' })
        this.scheduleWorkload()
        break
    }
  }

  private deliver(env: Envelope, doomed: boolean): void {
    if (this.trackMessages) this.inFlight.delete(env.id)
    const target = this.nodes[env.to] as RaftNode
    const reason = doomed
      ? 'network'
      : !this.canReach(env.from, env.to)
        ? 'partition'
        : !target.alive
          ? 'crashed'
          : null
    if (reason !== null) {
      this.stats.dropped++
      if (this.trackMessages) {
        this.recentDrops.push({ env, time: this.now, reason })
        if (this.recentDrops.length > 64) this.recentDrops.shift()
      }
      return
    }
    this.stats.delivered++
    this.applyEffects(target, target.onMessage(env.from, env.msg, this.now))
  }

  private send(from: NodeId, to: NodeId, msg: Message): void {
    const { latencyMin, latencyMax, duplicateRate } = this.config.network
    const rng = this.linkRng[from * this.config.nodeCount + to] as Rng
    const copies = rng.chance(duplicateRate) ? 2 : 1
    for (let i = 0; i < copies; i++) {
      const latency = rng.range(latencyMin, latencyMax)
      const doomed = rng.chance(this.dropRate)
      const env: Envelope = {
        id: this.msgSeq++,
        from,
        to,
        sentAt: this.now,
        deliverAt: this.now + latency,
        msg,
      }
      this.stats.sent++
      if (this.trackMessages) this.inFlight.set(env.id, env)
      this.schedule({ time: env.deliverAt, kind: 'deliver', env, doomed })
    }
  }

  private setTimer(node: NodeId, timer: TimerKind, at: number | null): void {
    const gens = this.timerGen[timer]
    const gen = (gens[node] ?? 0) + 1
    gens[node] = gen
    if (at !== null) this.schedule({ time: at, kind: 'timer', node, timer, gen })
  }

  private cancelTimers(node: NodeId): void {
    this.setTimer(node, 'election', null)
    this.setTimer(node, 'heartbeat', null)
  }

  private applyEffects(node: RaftNode, effects: readonly Effect[]): void {
    let logChanged = false
    for (const effect of effects) {
      switch (effect.kind) {
        case 'send':
          this.send(node.id, effect.to, effect.msg)
          break
        case 'electionTimer':
          this.setTimer(node.id, 'election', effect.at)
          break
        case 'heartbeatTimer':
          this.setTimer(node.id, 'heartbeat', effect.at)
          break
        case 'becameCandidate':
          this.log(
            'candidate',
            `${name(node.id)} timed out and started an election for term ${node.currentTerm}`,
            node,
          )
          break
        case 'becameLeader':
          this.log('elected', `${name(node.id)} won the election for term ${node.currentTerm}`, node)
          this.noteViolations(this.oracle.onBecomeLeader(node, this.now, this.eventCount, effect.logLength))
          break
        case 'steppedDown':
          if (effect.from === 'leader') {
            this.log('stepDown', `${name(node.id)} saw term ${node.currentTerm} and stepped down`, node)
          }
          break
        case 'commit':
          if (node.role === 'leader') {
            this.log('commit', `${name(node.id)} committed up to index ${effect.to}`, node)
          }
          this.noteViolations(this.oracle.onCommit(node, effect.from, effect.to, this.now, this.eventCount))
          break
        case 'logAppended':
          logChanged = true
          break
        case 'logTruncated':
          logChanged = true
          this.noteViolations(
            this.oracle.onTruncate(node, effect.from, effect.role, this.now, this.eventCount),
          )
          break
      }
    }
    if (logChanged) {
      this.noteViolations(this.oracle.checkLogMatching(node, this.nodes, this.now, this.eventCount))
    }
  }

  private applyAction(action: Action): void {
    switch (action.type) {
      case 'crash':
        this.crash(action.node, action.restartAfter)
        break
      case 'crashLeader': {
        const leader = this.leader
        if (leader) this.crash(leader.id, action.restartAfter)
        break
      }
      case 'restart': {
        const node = this.nodes[action.node]
        if (!node || node.alive) return
        this.log('restart', `${name(node.id)} restarted`, node)
        this.applyEffects(node, node.restart(this.now))
        break
      }
      case 'partition':
        this.setPartition(action.groups, action.healAfter)
        break
      case 'isolateLeader': {
        const leader = this.leader
        if (!leader) return
        const others = this.chaosRng.shuffle(this.nodes.filter((n) => n.id !== leader.id).map((n) => n.id))
        const minority = [leader.id, ...others.slice(0, action.withFollowers)]
        const majority = others.slice(action.withFollowers)
        this.setPartition([minority, majority], action.healAfter)
        break
      }
      case 'heal':
        if (this.partition !== null) {
          this.partition = null
          this.log('heal', 'Network healed: every node can reach every other node')
        }
        break
      case 'write':
        this.write(action.target)
        break
      case 'dropRate':
        this.dropRate = action.value
        this.log('dropRate', `Message loss set to ${Math.round(action.value * 100)}%`)
        break
      case 'bugs':
        this.bugs = action.bugs
        for (const node of this.nodes) node.bugs = action.bugs
        this.log('bugs', 'Injected bugs changed')
        break
    }
  }

  private crash(id: NodeId, restartAfter?: number): void {
    const node = this.nodes[id]
    if (!node?.alive) return
    node.crash()
    this.cancelTimers(id)
    this.log('crash', `${name(id)} crashed`, node)
    if (restartAfter !== undefined) {
      this.schedule({ time: this.now + restartAfter, kind: 'action', action: { type: 'restart', node: id } })
    }
  }

  private setPartition(groups: readonly (readonly NodeId[])[], healAfter?: number): void {
    const assignment = this.nodes.map(() => -1)
    groups.forEach((group, g) => {
      for (const id of group) assignment[id] = g
    })
    // Nodes not listed in any group stay together on one more side.
    for (let i = 0; i < assignment.length; i++) if (assignment[i] === -1) assignment[i] = groups.length
    this.partition = assignment
    const sides: NodeId[][] = []
    assignment.forEach((side, id) => {
      sides[side] = [...(sides[side] ?? []), id]
    })
    const label = sides
      .filter((side) => side.length > 0)
      .map((side) => `{${side.map(name).join(', ')}}`)
      .join(' | ')
    this.log('partition', `Network partitioned: ${label}`)
    if (healAfter !== undefined) {
      this.schedule({ time: this.now + healAfter, kind: 'action', action: { type: 'heal' } })
    }
  }

  private write(target?: NodeId): void {
    const node = target === undefined ? this.leader : (this.nodes[target] ?? null)
    const cmd = `w${this.writeSeq + 1}`
    const effects = node?.onClientRequest(cmd) ?? null
    if (node === null || effects === null) {
      this.stats.rejectedWrites++
      this.log('writeRejected', 'Client write rejected: no reachable leader')
      return
    }
    this.writeSeq++
    this.stats.writes++
    this.log('write', `Client wrote ${cmd} to ${name(node.id)} (index ${node.lastLogIndex})`, node)
    this.applyEffects(node, effects)
  }

  private noteViolations(found: readonly Violation[]): void {
    for (const v of found) this.log('violation', v.message, this.nodes[v.nodes[0] ?? 0])
  }

  private log(kind: TraceKind, detail: string, node?: RaftNode): void {
    if (!this.recordTrace && kind !== 'violation') return
    this.trace.push({
      time: this.now,
      eventIndex: this.eventCount,
      kind,
      node: node?.id,
      term: node?.currentTerm,
      detail,
    })
  }
}
