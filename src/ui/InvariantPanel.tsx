import { INVARIANT_INFO } from '../sim/invariants'
import { INVARIANT_IDS } from '../sim/types'
import type { SimController } from './controller'
import { CheckIcon, CrossIcon } from './icons'
import { useSim } from './useSim'

interface Props {
  readonly ctl: SimController
}

export function InvariantPanel({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster
  const violations = cluster.oracle.violations

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Safety invariants</h2>
        <span className="text-xs text-slate-400">checked after every event</span>
      </div>
      <ul className="mt-3 flex flex-col gap-3 text-sm">
        {INVARIANT_IDS.map((id) => {
          const info = INVARIANT_INFO[id]
          const violation = violations.find((v) => v.invariant === id)
          return (
            <li key={id} className="border-b border-slate-800/60 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-100">{info.title}</span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                    violation
                      ? 'bg-red-500/15 text-red-300 ring-red-500/40'
                      : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                  }`}
                >
                  {violation ? <CrossIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
                  {violation ? 'Violated' : 'Holds'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{info.rule}</p>
              {violation && (
                <div className="mt-2 rounded border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-200">
                  <p>{violation.message}</p>
                  <p className="mt-1 text-red-400">at t = {Math.round(violation.time)} ms</p>
                  <button
                    type="button"
                    onClick={() =>
                      ctl.restore({
                        session: ctl.session,
                        eventCount: violation.eventIndex,
                        now: violation.time,
                      })
                    }
                    className="mt-2 rounded border border-red-800 px-2 py-1 text-xs text-red-100 hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                  >
                    Jump to violation
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
