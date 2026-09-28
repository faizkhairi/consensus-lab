import { INVARIANT_INFO } from '../sim/invariants'
import { INVARIANT_IDS } from '../sim/types'
import type { SimController } from './controller'
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
      <h2 className="text-sm font-semibold text-slate-200">Safety invariants</h2>
      <ul className="mt-3 flex flex-col gap-3 text-sm">
        {INVARIANT_IDS.map((id) => {
          const info = INVARIANT_INFO[id]
          const violation = violations.find((v) => v.invariant === id)
          return (
            <li key={id} className="border-b border-slate-800/60 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-100">{info.title}</span>
                <span className={violation ? 'font-semibold text-red-400' : 'font-semibold text-emerald-400'}>
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
