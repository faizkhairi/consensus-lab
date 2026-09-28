import { hunt, shrink } from '../sim/fuzz'
import type { FuzzRequest, FuzzResponse } from './protocol'

// Seeds per slice. Between slices the worker yields, so a stop request is seen promptly.
const CHUNK = 25

let generation = 0

const post = (response: FuzzResponse) => self.postMessage(response)

self.onmessage = (event: MessageEvent<FuzzRequest>) => {
  const request = event.data
  generation++
  if (request.type === 'hunt') void run(request, generation)
}

async function run(request: Extract<FuzzRequest, { type: 'hunt' }>, id: number): Promise<void> {
  const started = performance.now()
  let tried = 0
  let events = 0
  const progress = () => ({ id: request.id, tried, events, elapsedMs: performance.now() - started })

  while (tried < request.seeds) {
    if (id !== generation) {
      post({ type: 'stopped', ...progress() })
      return
    }
    const seeds = Math.min(CHUNK, request.seeds - tried)
    const result = hunt({ bugs: request.bugs, seeds, startSeed: request.startSeed + tried })
    tried += result.tried
    events += result.events
    if (result.found) {
      post({ type: 'found', counterexample: result.found, ...progress() })
      post({ type: 'shrunk', id: request.id, result: shrink(result.found) })
      return
    }
    post({ type: 'progress', ...progress() })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  post({ type: 'clean', ...progress() })
}
