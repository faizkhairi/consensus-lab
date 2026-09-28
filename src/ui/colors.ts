import type { Role } from '../sim/types'

export const ROLE_COLOR: Record<Role, string> = {
  follower: '#94a3b8',
  candidate: '#fbbf24',
  leader: '#34d399',
}

export const ROLE_COLOR_CRASHED: Record<Role, string> = {
  follower: '#334155',
  candidate: '#4b3f1f',
  leader: '#0f2e24',
}

export const VOTE_REQUEST_COLOR = '#fcd34d'
export const VOTE_GRANTED_COLOR = '#6ee7b7'
export const VOTE_DENIED_COLOR = '#fda4af'
export const APPEND_ENTRIES_COLOR = '#7dd3fc'
export const APPEND_REPLY_COLOR = '#bae6fd'

export const PARTITION_CUT_COLOR = '#f43f5e'
export const VIOLATION_RING_COLOR = '#ef4444'
export const DROP_MARK_COLOR = '#f87171'
export const EDGE_COLOR = '#1e293b'
export const ELECTION_RING_COLOR = '#38bdf8'

export const TIMELINE_MARKER_COLOR: Record<string, string> = {
  elected: '#34d399',
  crash: '#fb7185',
  partition: '#fbbf24',
  heal: '#38bdf8',
  violation: '#ef4444',
}

export const TRACE_COLOR: Record<string, string> = {
  elected: 'text-emerald-400',
  candidate: 'text-amber-300',
  crash: 'text-rose-400',
  restart: 'text-sky-300',
  partition: 'text-amber-400',
  heal: 'text-sky-300',
  write: 'text-slate-400',
  writeRejected: 'text-rose-300',
  commit: 'text-slate-400',
  stepDown: 'text-slate-400',
  violation: 'text-red-400',
  bugs: 'text-fuchsia-300',
  dropRate: 'text-slate-400',
}

/** Deterministic hue for a log term, spaced by a step that spreads nearby terms apart. */
export function termHue(term: number): number {
  return (term * 47) % 360
}

export function termColor(term: number, lightness = 45): string {
  return `hsl(${termHue(term)}deg 65% ${lightness}%)`
}
