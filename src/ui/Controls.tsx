import { type KeyboardEvent, useState } from 'react'
import { encodeRun, MAX_SHARED_TIME } from '../sim/session'
import type { NodeId } from '../sim/types'
import type { SimController } from './controller'
import { PauseIcon, PlayIcon, StepBackIcon, StepIcon } from './icons'
import { interactiveSession } from './tour'
import { useSim } from './useSim'

const SPEEDS = [0.25, 0.5, 1, 2, 5, 20]

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000)
}

function shuffled(ids: readonly NodeId[]): NodeId[] {
  const result = [...ids]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = result[i] as NodeId
    const b = result[j] as NodeId
    result[i] = b
    result[j] = a
  }
  return result
}

function randomPartition(nodeCount: number): NodeId[][] {
  const ids = shuffled(Array.from({ length: nodeCount }, (_, i) => i))
  if (nodeCount < 4 || Math.random() < 0.5) {
    const cut = 1 + Math.floor(Math.random() * (nodeCount - 1))
    return [ids.slice(0, cut), ids.slice(cut)]
  }
  const cut1 = 1 + Math.floor(Math.random() * (nodeCount - 2))
  const cut2 = cut1 + 1 + Math.floor(Math.random() * (nodeCount - cut1 - 1))
  return [ids.slice(0, cut1), ids.slice(cut1, cut2), ids.slice(cut2)]
}

interface Props {
  readonly ctl: SimController
}

export function Controls({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster
  const [seedInput, setSeedInput] = useState(() => String(ctl.session.seed))
  // The tour, replays and share links load sessions too; show the seed that is actually running.
  const [shownSeed, setShownSeed] = useState(ctl.session.seed)
  if (shownSeed !== ctl.session.seed) {
    setShownSeed(ctl.session.seed)
    setSeedInput(String(ctl.session.seed))
  }
  const [status, setStatus] = useState('')

  const loadSeed = () => {
    const seed = Number(seedInput)
    if (!Number.isFinite(seed) || seed < 0) return
    ctl.load(interactiveSession(Math.floor(seed)))
    ctl.play()
  }

  const newSeed = () => {
    const seed = randomSeed()
    setSeedInput(String(seed))
    ctl.load(interactiveSession(seed))
    ctl.play()
  }

  const shareLink = async () => {
    if (cluster.now > MAX_SHARED_TIME) {
      setStatus(
        `Too long to share: links cover the first ${MAX_SHARED_TIME / 60_000} minutes of simulated time`,
      )
      return
    }
    const hash = `#run=${encodeRun({ session: ctl.session, time: cluster.now })}`
    const link = `${window.location.origin}${window.location.pathname}${hash}`
    window.history.replaceState(null, '', hash)
    try {
      await navigator.clipboard.writeText(link)
      setStatus('Link copied')
    } catch {
      setStatus('Could not copy the link')
    }
  }

  const onSeedKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') loadSeed()
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Playback</legend>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => ctl.stepBack()}
            disabled={cluster.eventCount === 0}
            aria-keyshortcuts="ArrowLeft"
            className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
          >
            <StepBackIcon className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={() => ctl.toggle()}
            aria-keyshortcuts="Space"
            className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            {ctl.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            {ctl.playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => ctl.stepOnce()}
            aria-keyshortcuts="ArrowRight"
            className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <StepIcon className="h-4 w-4" />
            Step
          </button>
          <label className="flex items-center gap-1.5 text-slate-300">
            Speed
            <select
              aria-label="Speed"
              value={ctl.speed}
              onChange={(event) => ctl.setSpeed(Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto tabular-nums text-slate-400">t = {Math.round(cluster.now)} ms</span>
        </div>
        <p className="text-xs text-slate-400">
          Keys: <kbd className="font-sans">Space</kbd> plays or pauses, <kbd className="font-sans">Left</kbd>{' '}
          and <kbd className="font-sans">Right</kbd> step one event.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Session</legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-slate-300">
            Seed
            <input
              aria-label="Seed"
              type="number"
              min={0}
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              onKeyDown={onSeedKeyDown}
              className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            />
          </label>
          <button
            type="button"
            onClick={loadSeed}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Load seed
          </button>
          <button
            type="button"
            onClick={newSeed}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            New seed
          </button>
          <button
            type="button"
            onClick={() => void shareLink()}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Share link
          </button>
          <span aria-live="polite" className="text-xs text-slate-400">
            {status}
          </span>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Client</legend>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => ctl.act({ type: 'write' })}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Client write
          </button>
          <span className="tabular-nums text-slate-400">
            {cluster.stats.writes} writes, {cluster.stats.rejectedWrites} rejected
          </span>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Faults</legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => ctl.act({ type: 'crashLeader' })}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Crash leader
          </button>
          <button
            type="button"
            onClick={() => ctl.act({ type: 'isolateLeader', withFollowers: 0 })}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Isolate leader
          </button>
          <button
            type="button"
            onClick={() => ctl.act({ type: 'isolateLeader', withFollowers: 1 })}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Isolate leader + 1 follower
          </button>
          <button
            type="button"
            onClick={() => ctl.act({ type: 'partition', groups: randomPartition(cluster.nodes.length) })}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Random partition
          </button>
          <button
            type="button"
            onClick={() => ctl.act({ type: 'heal' })}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Heal network
          </button>
        </div>
        <label className="mt-1 flex items-center gap-2 text-slate-300">
          Message loss
          <input
            aria-label="Message loss"
            type="range"
            min={0}
            max={50}
            value={Math.round(cluster.dropRate * 100)}
            onChange={(event) => ctl.act({ type: 'dropRate', value: Number(event.target.value) / 100 })}
            className="flex-1 accent-sky-400"
          />
          <span className="w-10 text-right tabular-nums">{Math.round(cluster.dropRate * 100)}%</span>
        </label>
      </fieldset>
    </div>
  )
}
