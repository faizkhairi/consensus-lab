import { TIMELINE_MARKER_COLOR } from './colors'
import type { SimController } from './controller'
import { useSim } from './useSim'

interface Props {
  readonly ctl: SimController
}

const MARKER_KINDS = new Set(['elected', 'crash', 'partition', 'heal', 'violation'])

export function Timeline({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster
  const max = Math.max(ctl.horizon, cluster.now, 1)
  // Keyed by trace position: one simulation event can emit several trace entries.
  const markers = ctl.horizonTrace
    .map((event, position) => ({ event, position }))
    .filter(({ event }) => MARKER_KINDS.has(event.kind))

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between text-xs text-slate-400">
        <span>t = {Math.round(cluster.now)} ms</span>
        <span>event #{cluster.eventCount}</span>
      </div>
      <div className="relative mt-2 h-4">
        {markers.map(({ event, position }) => (
          <span
            key={position}
            title={`${event.kind} at t=${Math.round(event.time)}: ${event.detail}`}
            className="absolute bottom-0 w-px"
            style={{
              left: `${(event.time / max) * 100}%`,
              height: event.kind === 'violation' ? '100%' : '65%',
              backgroundColor: TIMELINE_MARKER_COLOR[event.kind] ?? '#64748b',
            }}
          />
        ))}
      </div>
      <input
        type="range"
        aria-label="Timeline"
        min={0}
        max={max}
        step={1}
        value={cluster.now}
        onChange={(event) => ctl.seekTime(Number(event.target.value))}
        className="mt-1 w-full accent-sky-400"
      />
    </section>
  )
}
