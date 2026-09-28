import { useEffect, useRef, useState } from 'react'
import type { SimController, Snapshot } from './controller'
import { type Panel, TOUR } from './tour'
import { useSim } from './useSim'

interface Props {
  readonly ctl: SimController
  readonly onSetTab: (panel: Panel) => void
  readonly onExit: () => void
}

export function TourBar({ ctl, onSetTab, onExit }: Props) {
  useSim(ctl)
  const snapshots = useRef<Snapshot[]>([])
  const initialized = useRef(false)
  const [index, setIndex] = useState(0)
  // Handlers read the ref, not the render's `index`: a double click must not enter the same step twice.
  const current = useRef(0)
  const moveTo = (target: number) => {
    current.current = target
    setIndex(target)
  }

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const step = TOUR[0]
    if (!step) return
    snapshots.current[0] = ctl.snapshot()
    step.enter(ctl)
    if (step.panel) onSetTab(step.panel)
  }, [ctl, onSetTab])

  const step = TOUR[index]
  if (!step) return null
  const isLast = index === TOUR.length - 1

  const goNext = () => {
    if (current.current === TOUR.length - 1) {
      onExit()
      return
    }
    const target = current.current + 1
    const nextStep = TOUR[target]
    if (!nextStep) return
    snapshots.current[target] = ctl.snapshot()
    nextStep.enter(ctl)
    if (nextStep.panel) onSetTab(nextStep.panel)
    moveTo(target)
  }

  const goPrevious = () => {
    if (current.current === 0) return
    const target = current.current - 1
    const prevStep = TOUR[target]
    const snap = snapshots.current[target]
    if (!prevStep) return
    if (snap) ctl.restore(snap)
    prevStep.enter(ctl)
    if (prevStep.panel) onSetTab(prevStep.panel)
    moveTo(target)
  }

  const statusLine =
    ctl.lastStop === 'condition'
      ? 'Paused: ready for the next step'
      : ctl.lastStop === 'violation'
        ? 'Paused: the oracle caught a violation'
        : null

  return (
    <section aria-label="Guided tour" className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Step {index + 1} of {TOUR.length}
      </p>
      <h2 className="mt-1 text-base font-semibold text-slate-100">{step.title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-sm text-slate-300">
        {step.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {statusLine && (
        <p role="status" className="mt-2 text-xs text-sky-300">
          {statusLine}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={goPrevious}
          disabled={index === 0}
          className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={goNext}
          className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          {isLast ? 'Finish' : 'Next'}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          End tour
        </button>
      </div>
    </section>
  )
}
