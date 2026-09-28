# Design notes

This document explains how consensus-lab is built and why. The short version: the whole cluster runs inside a deterministic discrete-event simulation, a global oracle checks Raft's safety properties after every event, and because every run is a pure function of its inputs, a fuzzer can search thousands of runs for a violation and then shrink the one it finds.

## 1. Deterministic simulation

There is no wall clock and no `Math.random` in `src/sim`. A run is a function of:

- the **seed**,
- the **configuration** (timing profile, injected bugs),
- **timed faults** (fired at fixed virtual times: the nemesis or a scripted scenario),
- **recorded operator actions** (keyed by how many events had been processed when the action was taken).

The scheduler (`cluster.ts`) is a binary min-heap of events ordered by `(time, seq)`, where `seq` increases monotonically, so two events at the same virtual time always pop in the order they were scheduled. Virtual time jumps from one event to the next; a 6-second run takes a few milliseconds.

Randomness comes from xoshiro128\*\* streams (`rng.ts`). Each stream is derived from the root seed and a label, never from another stream's state:

| Stream | Used for |
|---|---|
| `link:<from>:<to>` (one per directed link) | latency, loss, duplication of messages on that link |
| `node:<id>` | that node's election timeouts |
| `chaos` | choices the nemesis makes at run time (which followers join an isolated leader) |
| `workload` | arrival times of client writes |
| `nemesis` | the fault schedule, generated up front |

Separate streams matter for shrinking. With a single network stream, removing one fault changes how many random numbers are drawn before every later message, so the rest of the run diverges completely (the butterfly effect) and a smaller schedule rarely reproduces the same bug. With one stream per link, removing a fault only perturbs the links it actually touched. In practice, switching to per-link streams made shrunk counterexamples noticeably smaller.

Operator actions are recorded against the event count rather than the time, because the UI can pause between two events that share a timestamp. Replaying a recorded action therefore lands at exactly the same point in the event sequence, and `Cluster.seek(eventCount, time)` can reconstruct any position.

## 2. The Raft implementation

`raft.ts` implements the core algorithm from the Raft paper (Ongaro and Ousterhout, 2014) as a pure state machine: handlers take a message or timeout and return a list of effects (send, set timer, commit, and so on). The node never touches the network or the clock, which makes it easy to test in isolation.

Implemented:

- leader election with randomized timeouts and the up-to-date check on votes (section 5.4.1);
- log replication with the consistency check, conflict truncation and a fast backtracking hint (`conflictIndex`), so a leader can skip back over a whole conflicting term in one round trip;
- the commit rule of section 5.4.2: a leader commits by counting replicas only for entries from its current term;
- a no-op entry appended when a leader is elected, so entries from earlier terms become committable promptly;
- persistence: `currentTerm`, `votedFor` and the log survive a crash; everything else is volatile.

Not implemented (see the README roadmap): membership changes, log compaction and snapshots, PreVote, CheckQuorum and leader leases, client sessions and linearizable reads.

## 3. The oracle

`invariants.ts` is a global observer. It sees every node at once, which no real node can, and checks the five properties from Figure 3 of the paper:

| Invariant | How it is checked |
|---|---|
| Election Safety | a map from term to the node elected in it; a second node elected in the same term is a violation |
| Leader Append-Only | any log truncation performed while the node is leader |
| Log Matching | after every log change, the changed log is compared with every other log: if they hold the same term at some index, every earlier entry must match |
| Leader Completeness | when a node wins an election, its log (as it was at that moment, before the new no-op) must contain every entry ever committed |
| State Machine Safety | a global record of committed entries by index; committing a different entry at a known index is a violation |

The oracle reports each invariant once and records the virtual time and event index, so the UI can jump straight to the moment it broke.

A clean fuzz run proves nothing unless the checks can fire. Every invariant has a positive-control test (`tests/invariants.test.ts`) that builds a bad state by hand and asserts the check reports it. Leader Append-Only is the one property none of the injected bugs break: in this implementation a leader always steps down before it accepts entries from another leader, so it never truncates while leading. Its positive control is the evidence that the check works.

## 4. Injected bugs

Each bug is a real, well-known way to get Raft wrong. Each is one flag, checked at one place in `raft.ts`.

| Bug | What changes | Invariant it breaks | Pinned counterexample |
|---|---|---|---|
| `commitPriorTerm` (Figure 8) | the leader counts replicas for entries from earlier terms too | Leader Completeness | seed 2829: 31 faults shrunk to 6 |
| `forgetVoteOnRestart` | `votedFor` is lost on restart | Election Safety | seed 338: 83 faults shrunk to 1 |
| `skipUpToDateCheck` | votes are granted without comparing logs | Leader Completeness | seed 2: 58 faults shrunk to 1 |

`commitPriorTerm` deliberately removes only the 5.4.2 counting rule and keeps the election no-op. With the no-op in place the bug is much harder to hit, because a new leader usually replicates its no-op before anything else. That is the realistic version: implementations that forget the rule usually still append a no-op.

The pinned counterexamples live in `src/sim/scenarios.ts`. The test suite checks that each one still fails, and that the same schedule passes with the bug switched off, which shows the flag is the cause.

## 5. Fuzzing

`nemesis.ts` generates a fault schedule up front, in the style of Jepsen's nemesis. Faults arrive with exponentially distributed gaps (mean 300 ms of virtual time) and are drawn from:

| Fault | Weight |
|---|---|
| crash the current leader, restart after 10 to 600 ms | 25% |
| crash a random node, restart after 10 to 600 ms | 20% |
| isolate the leader with 0 to 2 followers, heal after 80 to 900 ms | 20% |
| random two-way partition, heal after 80 to 900 ms | 20% |
| change message loss to 0%, 5%, 15% or 30% | 15% |

With 15% probability a slot is instead a flapping node: one node crashes every 15 to 60 ms for 200 to 700 ms, restarting after 2 to 20 ms each time. Lost-vote bugs need a node to crash and come back within a single election, and this pattern makes that common.

Every fault is self-contained: a crash carries its own restart delay and a partition its own heal delay. Leader-targeted faults are resolved when they fire rather than when they are generated. Both properties matter for shrinking: any subset of a schedule is still a valid schedule, and "crash the leader" still means something after the faults before it are removed.

The fuzzing profile (`fuzzConfig`) is more hostile than the interactive one: latency spread 5 to 45 ms (heavy reordering), 2% loss, 1% duplication, a client write every 20 to 120 ms, a narrow election-timeout window (150 to 220 ms, more split votes) and one entry per AppendEntries (lagging followers catch up slowly, which widens the windows where logs disagree).

Measured over consecutive seeds starting at 1, with 6 seconds of virtual time per seed:

| Mode | Runs with a violation | First seed that fails |
|---|---|---|
| correct (no bugs) | 0 of 20,000 | none |
| `commitPriorTerm` | 15 of 10,000 (0.15%) | 77 |
| `forgetVoteOnRestart` | 40 of 10,000 (0.4%) | 213 |
| `skipUpToDateCheck` | 9,019 of 10,000 (90%) | 1 |

Throughput on a laptop is about 4 million events per second in a single thread. CI runs 20,000 correct-mode seeds on every push.

## 6. Shrinking

`shrink()` in `fuzz.ts` minimises the fault list with delta debugging (a complement-only variant of Zeller's ddmin):

1. Drop every fault scheduled after the violation; it never fired.
2. Split the list into `n` chunks and try removing each chunk. If the run still breaks **the same invariant**, keep the smaller list and coarsen the split; otherwise refine it, down to single faults.
3. Trim the duration to just past the violation.

The seed stays fixed throughout, so each candidate is replayed deterministically. Requiring the same invariant (not just any violation) keeps the shrinker from wandering to an unrelated failure. The run budget defaults to 400 replays; typical shrinks finish in 20 to 200.

## 7. The UI

`src/ui/controller.ts` owns the running cluster and knows nothing about the DOM. The page drives it from `requestAnimationFrame` (at 1x, 100 ms of virtual time per real second, so individual messages are visible), and React subscribes to a version counter with `useSyncExternalStore`, so there is no React state update per simulation event.

Time travel is re-simulation. Scrubbing backwards rebuilds the cluster from its session and replays to the target, which takes milliseconds at this scale. Acting after scrubbing back discards the old future and starts a new branch. A share link encodes the session and the current time in the URL fragment, and the decoder validates every field before use. Opening a link replays the run synchronously, so links are limited to the first 10 minutes of simulated time (`MAX_SHARED_TIME`); a longer time would freeze the page.

The fuzzer runs in a Web Worker in slices of 25 seeds and yields between slices, so the page stays responsive and a stop request takes effect promptly.

## 8. Testing

| Layer | What it covers |
|---|---|
| unit (`tests/raft.test.ts` and others) | node handlers in isolation, the scheduler, replay and seek, the session codec |
| positive controls | each invariant fires on a hand-built bad state |
| scenario tests | election, replication, leader crash, minority partition and heal (the cut-off leader's uncommitted entries are overwritten, nothing committed is lost) |
| property tests (fast-check) | random fault schedules never violate safety in either profile; runs are deterministic; after faults stop, a leader is elected and a new write commits everywhere |
| fuzz | 300 seeds in the unit suite; 20,000 in CI; each bug is caught within a seed budget and shrinks to a smaller schedule that still fails |
| pinned counterexamples | still fail with the bug on, pass with it off |
| tour | every guided-tour step reaches its end state headlessly |
| end to end (Playwright) | election on load, share-link replay, tour, fuzz and replay, zero console errors, axe with no serious or critical findings |

Coverage of `src/sim` is enforced at 90% lines, functions and statements and 80% branches.
