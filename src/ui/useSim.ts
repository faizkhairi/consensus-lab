import { useSyncExternalStore } from 'react'
import type { SimController } from './controller'

/**
 * Subscribes the calling component to controller changes. Components read
 * `ctl.cluster` directly during render; this hook only drives the re-render.
 */
export function useSim(ctl: SimController): number {
  return useSyncExternalStore(ctl.subscribe, ctl.getVersion, ctl.getVersion)
}
