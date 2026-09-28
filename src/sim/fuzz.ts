import { Cluster } from './cluster'
import { fuzzConfig } from './config'
import { generateFaults } from './nemesis'
import { Rng } from './rng'
import type { BugFlags, InvariantId, SimConfig, TimedAction, Violation } from './types'

export const DEFAULT_FUZZ_DURATION = 6000

/** One fuzz run: the seed decides network and timer randomness, `faults` the injected failures. */
export interface FuzzCase {
  readonly seed: number
  readonly bugs: BugFlags
  readonly faults: readonly TimedAction[]
  readonly duration: number
}

export interface CaseResult {
  readonly violation: Violation | null
  readonly events: number
  readonly endTime: number
}

export interface Counterexample {
  readonly fuzzCase: FuzzCase
  readonly violation: Violation
}

export function makeCase(seed: number, bugs: BugFlags, duration = DEFAULT_FUZZ_DURATION): FuzzCase {
  const faults = generateFaults(new Rng(seed).fork('nemesis'), { duration, nodeCount: 5 })
  return { seed, bugs, faults, duration }
}

export function caseConfig(fuzzCase: FuzzCase): SimConfig {
  return fuzzConfig(fuzzCase.seed, fuzzCase.bugs)
}

export function runCase(fuzzCase: FuzzCase): CaseResult {
  const cluster = new Cluster(caseConfig(fuzzCase), {
    timed: fuzzCase.faults,
    recordTrace: false,
    trackMessages: false,
  })
  cluster.runUntil(fuzzCase.duration)
  return { violation: cluster.violation, events: cluster.eventCount, endTime: cluster.now }
}

export interface HuntOptions {
  readonly bugs: BugFlags
  readonly seeds: number
  readonly startSeed?: number
  readonly duration?: number
}

export interface HuntResult {
  readonly found: Counterexample | null
  readonly tried: number
  readonly events: number
}

/** Run seeds in order until one violates a safety property. */
export function hunt(options: HuntOptions): HuntResult {
  const start = options.startSeed ?? 1
  let events = 0
  for (let i = 0; i < options.seeds; i++) {
    const fuzzCase = makeCase(start + i, options.bugs, options.duration)
    const result = runCase(fuzzCase)
    events += result.events
    if (result.violation) return { found: { fuzzCase, violation: result.violation }, tried: i + 1, events }
  }
  return { found: null, tried: options.seeds, events }
}

export interface ShrinkResult {
  readonly original: Counterexample
  readonly shrunk: Counterexample
  readonly runs: number
}

/**
 * Minimise a counterexample's fault schedule with delta debugging (a complement-only variant of ddmin).
 *
 * The seed is fixed, so every candidate schedule is replayed deterministically;
 * a candidate is kept when it still breaks the same invariant. Faults after the
 * violation never fired and are dropped first, and the final duration is cut
 * to just past the violation.
 */
export function shrink(original: Counterexample, maxRuns = 400): ShrinkResult {
  const target: InvariantId = original.violation.invariant
  let runs = 0
  let best = original
  const attempt = (faults: readonly TimedAction[]): Counterexample | null => {
    runs++
    const fuzzCase = { ...best.fuzzCase, faults }
    const result = runCase(fuzzCase)
    return result.violation?.invariant === target ? { fuzzCase, violation: result.violation } : null
  }

  const fired = best.fuzzCase.faults.filter((f) => f.at <= best.violation.time)
  if (fired.length < best.fuzzCase.faults.length) best = attempt(fired) ?? best

  let granularity = 2
  while (best.fuzzCase.faults.length > 0 && runs < maxRuns) {
    const faults = best.fuzzCase.faults
    const chunk = Math.ceil(faults.length / granularity)
    let reduced = false
    for (let start = 0; start < faults.length && runs < maxRuns; start += chunk) {
      const candidate = attempt([...faults.slice(0, start), ...faults.slice(start + chunk)])
      if (candidate) {
        best = candidate
        granularity = Math.max(granularity - 1, 2)
        reduced = true
        break
      }
    }
    if (!reduced) {
      if (chunk <= 1) break
      granularity = Math.min(granularity * 2, faults.length)
    }
  }

  const trimmed = { ...best.fuzzCase, duration: Math.ceil(best.violation.time) + 1 }
  const check = runCase(trimmed)
  runs++
  if (check.violation?.invariant === target) best = { fuzzCase: trimmed, violation: check.violation }
  return { original, shrunk: best, runs }
}
