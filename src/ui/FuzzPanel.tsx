import { useEffect, useRef, useState } from 'react'
import type { Counterexample, ShrinkResult } from '../sim/fuzz'
import { INVARIANT_INFO } from '../sim/invariants'
import { describeAction } from '../sim/nemesis'
import { BUG_INFO, onlyBug } from '../sim/scenarios'
import { BUG_NAMES, type BugFlags, type BugName, NO_BUGS } from '../sim/types'
import type { FuzzRequest, FuzzResponse } from '../worker/protocol'
import type { SimController } from './controller'
import { replaySession } from './tour'

const SEED_OPTIONS = [1000, 5000, 20000]

interface Props {
  readonly ctl: SimController
  readonly onReplay: () => void
}

type BugChoice = BugName | 'none'

function bugsFor(choice: BugChoice): BugFlags {
  return choice === 'none' ? NO_BUGS : onlyBug(choice)
}

interface ProgressState {
  readonly tried: number
  readonly events: number
  readonly elapsedMs: number
}

export function FuzzPanel({ ctl, onReplay }: Props) {
  const workerRef = useRef<Worker | null>(null)
  const [choice, setChoice] = useState<BugChoice>('commitPriorTerm')
  const [seedCount, setSeedCount] = useState(5000)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [found, setFound] = useState<Counterexample | null>(null)
  const [foundAt, setFoundAt] = useState(0)
  const [shrinking, setShrinking] = useState(false)
  const [shrunk, setShrunk] = useState<ShrinkResult | null>(null)
  const [clean, setClean] = useState<number | null>(null)

  const huntId = useRef(0)

  const getWorker = (): Worker => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('../worker/fuzz.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<FuzzResponse>) => {
        const response = event.data
        // A stop and a new hunt can overtake an earlier hunt's last messages.
        if (response.id !== huntId.current) return
        switch (response.type) {
          case 'progress':
            setProgress(response)
            break
          case 'found':
            setProgress(response)
            setFound(response.counterexample)
            setFoundAt(response.tried)
            setShrinking(true)
            break
          case 'shrunk':
            setShrunk(response.result)
            setShrinking(false)
            setRunning(false)
            break
          case 'clean':
            setProgress(response)
            setClean(response.tried)
            setRunning(false)
            break
          case 'stopped':
            setProgress(response)
            setRunning(false)
            break
        }
      }
      workerRef.current = worker
    }
    return workerRef.current
  }

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const startHunt = () => {
    setProgress(null)
    setFound(null)
    setShrinking(false)
    setShrunk(null)
    setClean(null)
    setRunning(true)
    huntId.current++
    const request: FuzzRequest = {
      type: 'hunt',
      id: huntId.current,
      bugs: bugsFor(choice),
      seeds: seedCount,
      startSeed: 1,
    }
    getWorker().postMessage(request)
  }

  const stopHunt = () => {
    const stop: FuzzRequest = { type: 'stop' }
    getWorker().postMessage(stop)
  }

  const replay = () => {
    if (!shrunk) return
    const fuzzCase = shrunk.shrunk.fuzzCase
    const time = Math.max(0, shrunk.shrunk.violation.time - 700)
    ctl.load(replaySession(fuzzCase), { time, horizon: fuzzCase.duration })
    ctl.setSpeed(1)
    ctl.play()
    onReplay()
  }

  const rate =
    progress && progress.elapsedMs > 0 ? Math.round((progress.events / progress.elapsedMs) * 1000) : 0

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-slate-300">
          Bug to hunt
          <select
            aria-label="Bug to hunt"
            value={choice}
            onChange={(event) => setChoice(event.target.value as BugChoice)}
            disabled={running}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            {BUG_NAMES.map((name) => (
              <option key={name} value={name}>
                {BUG_INFO[name].title}
              </option>
            ))}
            <option value="none">No bug (control run)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-slate-300">
          Seeds
          <select
            aria-label="Seeds"
            value={seedCount}
            onChange={(event) => setSeedCount(Number(event.target.value))}
            disabled={running}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            {SEED_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={running ? stopHunt : startHunt}
          className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          {running ? 'Stop' : 'Hunt'}
        </button>
      </div>

      <div>
        <div
          role="progressbar"
          aria-label="Fuzzing progress"
          aria-valuenow={progress?.tried ?? 0}
          aria-valuemin={0}
          aria-valuemax={seedCount}
          className="h-2 w-full overflow-hidden rounded bg-slate-800"
        >
          <div
            className="h-full bg-sky-400"
            style={{ width: `${Math.min(100, ((progress?.tried ?? 0) / seedCount) * 100)}%` }}
          />
        </div>
        <p className="mt-1 tabular-nums text-xs text-slate-400">
          {progress?.tried ?? 0} seeds, {progress?.events ?? 0} events, {rate} events/s
        </p>
      </div>

      {found && (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-100">
          <p>
            Found a violation at seed {found.fuzzCase.seed} after {foundAt} seeds:{' '}
            {INVARIANT_INFO[found.violation.invariant].title}
          </p>
          <p className="mt-1">{found.violation.message}</p>
          {shrinking && <p className="mt-2 text-amber-300">Shrinking...</p>}
        </div>
      )}

      {shrunk && (
        <div className="rounded border border-slate-800 p-3 text-xs text-slate-300">
          <p className="font-semibold text-slate-100">
            Shrunk from {shrunk.original.fuzzCase.faults.length} to {shrunk.shrunk.fuzzCase.faults.length}{' '}
            faults in {shrunk.runs} runs
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            {shrunk.shrunk.fuzzCase.faults
              .map((fault, position) => ({ fault, position }))
              .map(({ fault, position }) => (
                <li key={position}>
                  t = {Math.round(fault.at)} ms: {describeAction(fault.action)}
                </li>
              ))}
          </ol>
          <button
            type="button"
            onClick={replay}
            className="mt-3 rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Replay counterexample
          </button>
        </div>
      )}

      {clean !== null && !found && <p className="text-xs text-slate-400">No violation in {clean} seeds.</p>}
    </div>
  )
}
