import type { Cluster } from '../sim/cluster'
import { createCluster, type Session } from '../sim/session'
import type { Action, TraceEvent } from '../sim/types'

/** Virtual milliseconds simulated per real second at 1x speed: slow motion, so messages are visible. */
export const VIRTUAL_MS_PER_SECOND = 100

export type StopReason = 'violation' | 'condition' | 'limit'

export interface Snapshot {
  readonly session: Session
  readonly eventCount: number
  readonly now: number
}

export interface LoadOptions {
  /** Start the view at this virtual time. */
  readonly time?: number
  /** Simulate this far ahead once, so the timeline can show upcoming events. */
  readonly horizon?: number
}

/**
 * Owns the running simulation for the UI. It holds no DOM or React state:
 * the page drives it with `tick()` from requestAnimationFrame and subscribes
 * to `version`, and tests drive it with `runHeadless()`.
 *
 * Time travel works by re-simulating: the cluster is a pure function of the
 * session, so jumping back means rebuilding from t = 0 and replaying up to the
 * target, which takes milliseconds for runs of this size.
 */
export class SimController {
  session: Session
  cluster: Cluster
  playing = false
  speed = 1
  lastStop: StopReason | null = null
  /** Furthest point simulated in this timeline, and the trace up to it (for timeline markers). */
  horizon = 0
  horizonTrace: readonly TraceEvent[] = []

  private version = 0
  private readonly listeners = new Set<() => void>()
  private until: ((cluster: Cluster) => boolean) | null = null
  private seenViolations = 0

  constructor(session: Session, options: LoadOptions = {}) {
    this.session = session
    this.cluster = createCluster(session)
    this.load(session, options)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getVersion = (): number => this.version

  load(session: Session, options: LoadOptions = {}): void {
    this.session = session
    this.playing = false
    this.until = null
    this.lastStop = null
    this.horizon = 0
    this.horizonTrace = []
    if (options.horizon !== undefined) {
      const preview = createCluster(session)
      preview.runUntil(options.horizon, false)
      this.horizon = preview.now
      this.horizonTrace = preview.trace
    }
    this.rebuild()
    if (options.time) this.cluster.runUntil(options.time, false)
    this.afterMove()
  }

  play(): void {
    this.playing = true
    this.lastStop = null
    this.emit()
  }

  pause(): void {
    this.playing = false
    this.until = null
    this.emit()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.emit()
  }

  /** Play until the predicate holds (checked after every event), then pause. */
  playUntil(predicate: (cluster: Cluster) => boolean): void {
    this.until = predicate
    this.play()
  }

  /** Advance by real elapsed time, scaled by speed. Called once per animation frame. */
  tick(realMs: number): void {
    if (!this.playing) return
    this.advance((realMs / 1000) * VIRTUAL_MS_PER_SECOND * this.speed)
  }

  /** Process exactly one event, then pause. */
  stepOnce(): void {
    this.playing = false
    this.until = null
    this.cluster.step()
    this.afterMove()
  }

  /**
   * Undo the last processed event, then pause. Re-simulates to one event
   * earlier with the clock at the undone event's time, so operator actions
   * taken between the two events are replayed rather than dropped.
   */
  stepBack(): void {
    this.playing = false
    this.until = null
    const target = this.cluster.eventCount - 1
    if (target >= 0) {
      const time = this.cluster.lastEventTime
      this.rebuild()
      this.cluster.seek(target, time)
    }
    this.afterMove()
  }

  /** Run a pending `playUntil` without real time passing (for tests and headless use). */
  runHeadless(maxVirtualMs: number): StopReason {
    const end = this.cluster.now + maxVirtualMs
    while (this.playing && this.cluster.now < end) this.advance(Math.min(50, end - this.cluster.now))
    if (this.playing) {
      this.pause()
      this.lastStop = 'limit'
    }
    return this.lastStop ?? 'limit'
  }

  /** Apply an operator action. Acting in the past discards the old future (a new branch). */
  act(action: Action): void {
    if (this.cluster.recorded.length < this.session.recorded.length) {
      const position = { eventCount: this.cluster.eventCount, now: this.cluster.now }
      this.session = { ...this.session, recorded: [...this.cluster.recorded] }
      this.rebuild()
      this.cluster.seek(position.eventCount, position.now)
      this.horizon = 0
      this.horizonTrace = []
    }
    this.cluster.act(action)
    this.session = { ...this.session, recorded: [...this.cluster.recorded] }
    this.afterMove()
  }

  /** Jump to a virtual time, re-simulating from the start when going backwards. */
  seekTime(time: number): void {
    this.playing = false
    this.until = null
    if (time < this.cluster.now) this.rebuild()
    this.cluster.runUntil(time, false)
    this.afterMove()
  }

  snapshot(): Snapshot {
    return { session: this.session, eventCount: this.cluster.eventCount, now: this.cluster.now }
  }

  restore(snapshot: Snapshot): void {
    this.session = snapshot.session
    this.playing = false
    this.until = null
    this.rebuild()
    this.cluster.seek(snapshot.eventCount, snapshot.now)
    this.afterMove()
  }

  private advance(virtualMs: number): void {
    const cluster = this.cluster
    const target = cluster.now + virtualMs
    for (;;) {
      const next = cluster.nextEventTime
      if (next === null || next > target) break
      cluster.step()
      if (cluster.oracle.violations.length > this.seenViolations) {
        this.seenViolations = cluster.oracle.violations.length
        this.stop('violation')
        return
      }
      if (this.until?.(cluster)) {
        this.stop('condition')
        return
      }
    }
    cluster.seek(cluster.eventCount, target)
    this.afterMove()
  }

  private stop(reason: StopReason): void {
    this.playing = false
    this.until = null
    this.lastStop = reason
    this.afterMove()
  }

  private rebuild(): void {
    this.cluster = createCluster(this.session)
    this.seenViolations = 0
  }

  private afterMove(): void {
    this.seenViolations = this.cluster.oracle.violations.length
    if (this.cluster.now >= this.horizon) {
      this.horizon = this.cluster.now
      this.horizonTrace = this.cluster.trace
    }
    this.emit()
  }

  private emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }
}
