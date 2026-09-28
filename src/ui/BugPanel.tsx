import { INVARIANT_INFO } from '../sim/invariants'
import { BUG_INFO, PINNED } from '../sim/scenarios'
import { BUG_NAMES } from '../sim/types'
import type { SimController } from './controller'
import { replaySession } from './tour'
import { useSim } from './useSim'

interface Props {
  readonly ctl: SimController
}

export function BugPanel({ ctl }: Props) {
  useSim(ctl)
  const bugs = ctl.cluster.bugs

  const toggle = (name: (typeof BUG_NAMES)[number]) => {
    ctl.act({ type: 'bugs', bugs: { ...bugs, [name]: !bugs[name] } })
  }

  const replayPinned = (name: (typeof BUG_NAMES)[number]) => {
    const fuzzCase = PINNED[name]
    const guess = fuzzCase.duration - 700
    ctl.load(replaySession(fuzzCase), { time: Math.max(0, guess), horizon: fuzzCase.duration })
    ctl.setSpeed(1)
    ctl.play()
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {BUG_NAMES.map((name) => {
        const info = BUG_INFO[name]
        const checked = bugs[name]
        return (
          <div key={name} className="rounded border border-slate-800 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-100">{info.title}</h3>
                <p className="mt-1 text-xs text-slate-400">{info.summary}</p>
                <p className="mt-1 text-xs text-slate-400">Breaks: {INVARIANT_INFO[info.breaks].title}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={info.title}
                onClick={() => toggle(name)}
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                  checked ? 'border-emerald-400 bg-emerald-500/40' : 'border-slate-600 bg-slate-800'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-slate-100 transition-transform ${
                    checked ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <button
              type="button"
              onClick={() => replayPinned(name)}
              className="mt-2 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Replay a pinned counterexample
            </button>
          </div>
        )
      })}
    </div>
  )
}
