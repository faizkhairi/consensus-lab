import type { SimController } from './controller'
import { PauseIcon, PlayIcon, StepBackIcon, StepIcon } from './icons'
import { useSim } from './useSim'

interface Props {
  readonly ctl: SimController
}

const BUTTON =
  'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100 active:bg-slate-800 aria-disabled:opacity-40'

// Below the lg breakpoint the playback controls sit far below the cluster, so this dock keeps
// them in reach. It is display: none at lg and up, which also removes it from the accessibility tree.
export function PlaybackDock({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/90 px-4 pt-2 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <fieldset className="mx-auto flex max-w-md min-w-0 items-center gap-2">
        <legend className="sr-only">Quick playback</legend>
        <button
          type="button"
          onClick={() => ctl.stepBack()}
          aria-disabled={cluster.eventCount === 0}
          className={BUTTON}
        >
          <StepBackIcon className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={() => ctl.toggle()}
          className={`${BUTTON} border-sky-700 text-sky-200`}
        >
          {ctl.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          {ctl.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => ctl.stepOnce()} className={BUTTON}>
          <StepIcon className="h-4 w-4" />
          Step
        </button>
        <span className="hidden shrink-0 text-right text-xs text-slate-400 min-[400px]:inline">
          t = {Math.round(cluster.now)} ms
        </span>
      </fieldset>
    </div>
  )
}
