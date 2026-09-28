import { useEffect, useRef, useState } from 'react'
import { decodeRun, type Session } from '../sim/session'
import { BugPanel } from './BugPanel'
import { ClusterView } from './ClusterView'
import { Controls } from './Controls'
import { type LoadOptions, SimController } from './controller'
import { EventFeed } from './EventFeed'
import { FuzzPanel } from './FuzzPanel'
import { InvariantPanel } from './InvariantPanel'
import { LogGrid } from './LogGrid'
import { NodeTable } from './NodeTable'
import { Timeline } from './Timeline'
import { TourBar } from './TourBar'
import { interactiveSession, type Panel } from './tour'
import { useSim } from './useSim'

const REPO_URL = 'https://github.com/faizkhairi/consensus-lab'
const DESIGN_DOC_URL = `${REPO_URL}/blob/main/docs/DESIGN.md`

const TABS: { readonly id: Panel; readonly label: string }[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'bugs', label: 'Bugs' },
  { id: 'fuzz', label: 'Fuzzer' },
]

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface InitialLoad {
  readonly session: Session
  readonly options: LoadOptions
  readonly autoplay: boolean
}

function resolveInitialLoad(): InitialLoad {
  const hash = window.location.hash
  if (hash.startsWith('#run=')) {
    const decoded = decodeRun(hash.slice('#run='.length))
    if (decoded) {
      return {
        session: decoded.session,
        options: { time: decoded.time, horizon: decoded.time },
        autoplay: false,
      }
    }
  }
  return { session: interactiveSession(randomSeed()), options: {}, autoplay: !prefersReducedMotion() }
}

export function App() {
  const [{ ctl, autoplay }] = useState(() => {
    const initial = resolveInitialLoad()
    return { ctl: new SimController(initial.session, initial.options), autoplay: initial.autoplay }
  })
  const [touring, setTouring] = useState(false)
  const [tab, setTab] = useState<Panel>('controls')
  useSim(ctl)

  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (autoplay) ctl.play()
  }, [ctl, autoplay])

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = now - last
      last = now
      ctl.tick(Math.min(dt, 100))
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [ctl])

  useEffect(() => {
    const isFormElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      return ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFormElement(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        ctl.toggle()
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        ctl.stepOnce()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ctl])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">consensus-lab</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              A deterministic Raft simulator with a live safety oracle and a fuzzer that finds and shrinks
              counterexamples.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setTouring(true)}
              className="rounded border border-sky-700 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Take the tour
            </button>
            <a
              href={REPO_URL}
              className="rounded px-2 py-1.5 text-slate-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Source
            </a>
            <a
              href={DESIGN_DOC_URL}
              className="rounded px-2 py-1.5 text-slate-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              How it works
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {touring && <TourBar ctl={ctl} onSetTab={setTab} onExit={() => setTouring(false)} />}
          <ClusterView ctl={ctl} />
          <Timeline ctl={ctl} />
          <LogGrid ctl={ctl} />
          <NodeTable ctl={ctl} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <InvariantPanel ctl={ctl} />

          <section className="rounded-lg border border-slate-800 bg-slate-900">
            <div role="tablist" aria-label="Simulation panels" className="flex border-b border-slate-800">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    tab === t.id
                      ? 'border-b-2 border-sky-400 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              id="panel-controls"
              role="tabpanel"
              aria-labelledby="tab-controls"
              hidden={tab !== 'controls'}
              className="p-4"
            >
              <Controls ctl={ctl} />
            </div>
            <div
              id="panel-bugs"
              role="tabpanel"
              aria-labelledby="tab-bugs"
              hidden={tab !== 'bugs'}
              className="p-4"
            >
              <BugPanel ctl={ctl} />
            </div>
            <div
              id="panel-fuzz"
              role="tabpanel"
              aria-labelledby="tab-fuzz"
              hidden={tab !== 'fuzz'}
              className="p-4"
            >
              <FuzzPanel ctl={ctl} onReplay={() => setTab('controls')} />
            </div>
          </section>

          <EventFeed ctl={ctl} />
        </div>
      </main>
    </div>
  )
}
