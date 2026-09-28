import { Cluster, type ClusterOptions } from './cluster'
import { fuzzConfig, interactiveConfig } from './config'
import {
  type Action,
  BUG_NAMES,
  type BugFlags,
  NO_BUGS,
  type NodeId,
  type RecordedAction,
  type SimConfig,
  type TimedAction,
} from './types'

export type SessionMode = 'interactive' | 'fuzz'

/**
 * Everything needed to reproduce a run: the seed, which timing profile, the
 * injected bugs, faults fired at fixed times and operator actions recorded by
 * event count. A run is a pure function of its session.
 */
export interface Session {
  readonly seed: number
  readonly mode: SessionMode
  readonly bugs: BugFlags
  readonly timed: readonly TimedAction[]
  readonly recorded: readonly RecordedAction[]
}

export function sessionConfig(session: Session): SimConfig {
  return session.mode === 'fuzz'
    ? fuzzConfig(session.seed, session.bugs)
    : interactiveConfig(session.seed, session.bugs)
}

export function createCluster(
  session: Session,
  options: Omit<ClusterOptions, 'timed' | 'recorded'> = {},
): Cluster {
  return new Cluster(sessionConfig(session), { ...options, timed: session.timed, recorded: session.recorded })
}

export interface SharedRun {
  readonly session: Session
  /** Virtual time the link points at. */
  readonly time: number
}

const VERSION = 1

/**
 * Latest virtual time a link may point at. Opening a link re-simulates up to
 * it synchronously, so an unbounded value would freeze the page; 10 minutes
 * of simulated time replays in about a tenth of a second.
 */
export const MAX_SHARED_TIME = 600_000

/** Encode a run for a URL fragment: compact JSON, then base64url. */
export function encodeRun(run: SharedRun): string {
  const { session } = run
  const payload = {
    v: VERSION,
    s: session.seed,
    m: session.mode,
    b: BUG_NAMES.filter((name) => session.bugs[name]),
    ta: session.timed,
    ra: session.recorded,
    t: Math.round(run.time),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode a URL fragment payload. Returns null for anything malformed rather than trusting it. */
export function decodeRun(encoded: string): SharedRun | null {
  let data: unknown
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!isRecord(data) || data.v !== VERSION) return null
  const { s, m, b, ta, ra, t } = data
  if (
    !isUint32(s) ||
    (m !== 'interactive' && m !== 'fuzz') ||
    !isFiniteNumber(t) ||
    t < 0 ||
    t > MAX_SHARED_TIME
  )
    return null
  if (!Array.isArray(b) || !b.every((name) => (BUG_NAMES as readonly unknown[]).includes(name))) return null
  if (!Array.isArray(ta) || !ta.every(isTimedAction)) return null
  if (!Array.isArray(ra) || !ra.every(isRecordedAction)) return null
  const bugs: Record<keyof BugFlags, boolean> = { ...NO_BUGS }
  for (const name of b as (keyof BugFlags)[]) bugs[name] = true
  return {
    session: { seed: s, mode: m, bugs, timed: ta, recorded: ra },
    time: t,
  }
}

const MAX_NODES = 5

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff
}

function isNodeId(value: unknown): value is NodeId {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < MAX_NODES
}

function isDelay(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0)
}

function isTimedAction(value: unknown): value is TimedAction {
  return isRecord(value) && isFiniteNumber(value.at) && value.at >= 0 && isAction(value.action)
}

function isRecordedAction(value: unknown): value is RecordedAction {
  return (
    isRecord(value) &&
    Number.isInteger(value.afterEvents) &&
    (value.afterEvents as number) >= 0 &&
    isFiniteNumber(value.at) &&
    value.at >= 0 &&
    isAction(value.action)
  )
}

export function isAction(value: unknown): value is Action {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'crash':
      return isNodeId(value.node) && isDelay(value.restartAfter)
    case 'restart':
      return isNodeId(value.node)
    case 'crashLeader':
      return isDelay(value.restartAfter)
    case 'partition':
      return (
        Array.isArray(value.groups) &&
        value.groups.every((g) => Array.isArray(g) && g.every(isNodeId)) &&
        isDelay(value.healAfter)
      )
    case 'isolateLeader':
      return (
        Number.isInteger(value.withFollowers) &&
        (value.withFollowers as number) >= 0 &&
        isDelay(value.healAfter)
      )
    case 'heal':
      return true
    case 'write':
      return value.target === undefined || isNodeId(value.target)
    case 'dropRate':
      return isFiniteNumber(value.value) && value.value >= 0 && value.value <= 1
    case 'bugs':
      return (
        isRecord(value.bugs) &&
        BUG_NAMES.every((name) => typeof (value.bugs as Record<string, unknown>)[name] === 'boolean')
      )
    default:
      return false
  }
}
