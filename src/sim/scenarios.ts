import type { FuzzCase } from './fuzz'
import { type BugFlags, type BugName, type InvariantId, NO_BUGS } from './types'

export interface BugInfo {
  readonly title: string
  readonly summary: string
  /** The invariant the fuzzer reports when it catches this bug. */
  readonly breaks: InvariantId
}

export const BUG_INFO: Record<BugName, BugInfo> = {
  commitPriorTerm: {
    title: 'Commit entries from earlier terms',
    summary:
      'The leader treats any entry stored on a majority as committed, even one from an earlier term. ' +
      "Raft section 5.4.2 forbids this: such an entry can still be overwritten (the paper's Figure 8).",
    breaks: 'leaderCompleteness',
  },
  forgetVoteOnRestart: {
    title: 'Forget the vote on restart',
    summary:
      'votedFor is kept only in memory. A node that votes, crashes and restarts within the same term ' +
      'can vote again, so two candidates can each collect a majority.',
    breaks: 'electionSafety',
  },
  skipUpToDateCheck: {
    title: 'Skip the up-to-date check',
    summary:
      'Voters grant their vote without comparing logs (section 5.4.1), so a candidate missing committed ' +
      'entries can win and later overwrite them.',
    breaks: 'leaderCompleteness',
  },
}

export function onlyBug(name: BugName): BugFlags {
  return { ...NO_BUGS, [name]: true }
}

/**
 * Counterexamples the fuzzer found and shrank, pinned so the suite proves they
 * still reproduce and the tour can replay them. Each one runs on the fuzzing
 * profile (`fuzzConfig`), so the seed also drives network and timer randomness.
 */
export const PINNED: Record<BugName, FuzzCase> = {
  // Found at seed 2829 with 31 faults, shrunk to 6.
  commitPriorTerm: {
    seed: 2829,
    bugs: onlyBug('commitPriorTerm'),
    duration: 3780,
    faults: [
      { at: 556, action: { type: 'isolateLeader', withFollowers: 2, healAfter: 390 } },
      { at: 968, action: { type: 'dropRate', value: 0.05 } },
      { at: 2250, action: { type: 'isolateLeader', withFollowers: 0, healAfter: 702 } },
      { at: 2451, action: { type: 'crash', node: 3, restartAfter: 185 } },
      { at: 2933, action: { type: 'crashLeader', restartAfter: 454 } },
      { at: 3463, action: { type: 'crashLeader', restartAfter: 133 } },
    ],
  },
  // Found at seed 338 with 83 faults, shrunk to 1.
  forgetVoteOnRestart: {
    seed: 338,
    bugs: onlyBug('forgetVoteOnRestart'),
    duration: 414,
    faults: [{ at: 384, action: { type: 'crash', node: 3, restartAfter: 5 } }],
  },
  // Found at seed 2 with 58 faults, shrunk to 1.
  skipUpToDateCheck: {
    seed: 2,
    bugs: onlyBug('skipUpToDateCheck'),
    duration: 1090,
    faults: [
      {
        at: 885,
        action: {
          type: 'partition',
          groups: [
            [1, 3, 0],
            [2, 4],
          ],
          healAfter: 177,
        },
      },
    ],
  },
}
