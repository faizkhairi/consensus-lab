import { type BugFlags, NO_BUGS, type SimConfig } from './types'

/** Interactive defaults: timings in the ratio the Raft paper suggests (RTT << heartbeat << election timeout). */
export function interactiveConfig(seed: number, bugs: BugFlags = NO_BUGS): SimConfig {
  return {
    seed,
    nodeCount: 5,
    raft: { electionTimeoutMin: 150, electionTimeoutMax: 300, heartbeatInterval: 50, maxEntriesPerAppend: 4 },
    network: { latencyMin: 10, latencyMax: 30, dropRate: 0, duplicateRate: 0 },
    bugs,
    workload: null,
  }
}

/**
 * Fuzzing defaults: a hostile network (wide latency spread for reordering,
 * loss, duplication), a busy client, a narrow election-timeout window (more
 * split votes) and one entry per AppendEntries so lagging followers catch up
 * one step at a time. All of it widens the space of
 * interleavings the fuzzer explores per seed.
 */
export function fuzzConfig(seed: number, bugs: BugFlags = NO_BUGS): SimConfig {
  return {
    seed,
    nodeCount: 5,
    raft: { electionTimeoutMin: 150, electionTimeoutMax: 220, heartbeatInterval: 50, maxEntriesPerAppend: 1 },
    network: { latencyMin: 5, latencyMax: 45, dropRate: 0.02, duplicateRate: 0.01 },
    bugs,
    workload: { intervalMin: 20, intervalMax: 120 },
  }
}
