import { useEffect, useRef, useState } from 'react'
import type { TraceEvent, TraceKind } from '../sim/types'
import { TRACE_COLOR } from './colors'
import type { SimController } from './controller'
import { useSim } from './useSim'

const HIDDEN_IN_FUZZ = new Set<TraceKind>(['write', 'writeRejected', 'commit'])
const FEED_LIMIT = 14
const ANNOUNCED_KINDS = new Set<TraceKind>(['elected', 'violation'])

interface Props {
  readonly ctl: SimController
}

export function EventFeed({ ctl }: Props) {
  const version = useSim(ctl)
  const cluster = ctl.cluster
  const hideWrites = ctl.session.mode === 'fuzz'
  // Newest first. One simulation event can emit several trace entries, so the
  // key is the entry's position in the append-only trace, not its event index.
  const recent: { event: TraceEvent; position: number }[] = []
  for (let position = cluster.trace.length - 1; position >= 0 && recent.length < FEED_LIMIT; position--) {
    const event = cluster.trace[position] as TraceEvent
    if (!(hideWrites && HIDDEN_IN_FUZZ.has(event.kind))) recent.push({ event, position })
  }

  const [announcement, setAnnouncement] = useState('')
  // The trace array is mutated in place and replaced on time travel, so track both the array and the index.
  const lastAnnounced = useRef<{ trace: unknown; eventIndex: number }>({ trace: null, eventIndex: -1 })

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` changes whenever the simulation moves.
  useEffect(() => {
    const trace = ctl.cluster.trace
    const latest = trace.findLast((e) => ANNOUNCED_KINDS.has(e.kind))
    if (!latest) return
    const last = lastAnnounced.current
    if (last.trace === trace && latest.eventIndex <= last.eventIndex) return
    lastAnnounced.current = { trace, eventIndex: latest.eventIndex }
    setAnnouncement(latest.detail)
  }, [ctl, version])

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold text-slate-200">Events</h2>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {recent.map(({ event, position }) => (
          <li
            key={position}
            className={`${TRACE_COLOR[event.kind] ?? 'text-slate-400'} ${
              event.kind === 'violation' ? 'font-bold' : ''
            }`}
          >
            t={Math.round(event.time)} {event.detail}
          </li>
        ))}
        {recent.length === 0 && <li className="text-slate-400">No events yet.</li>}
      </ul>
    </section>
  )
}
