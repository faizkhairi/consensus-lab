/**
 * Seeded PRNG (xoshiro128**) with named, independent streams.
 *
 * Determinism is the foundation of the simulator: every random choice (message
 * latency, drops, election timeouts, the fault schedule) comes from one of these
 * streams, so a run is a pure function of its seed and inputs. Streams are
 * derived from the root seed and a label, never from another stream's state, so
 * drawing more numbers in one stream (say, the network) cannot shift another
 * (say, node 3's election timer).
 */

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combine two 32-bit values into one well-mixed 32-bit value. */
export function mix32(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

function splitmix32(state: number): () => number {
  let s = state >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return (z ^ (z >>> 16)) >>> 0
  }
}

export class Rng {
  readonly seed: number
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: number) {
    this.seed = seed >>> 0
    const init = splitmix32(this.seed)
    this.a = init()
    this.b = init()
    this.c = init()
    this.d = init()
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0
    const t = this.b << 9
    this.c ^= this.a
    this.d ^= this.b
    this.b ^= this.c
    this.a ^= this.d
    this.c ^= t
    this.d = rotl(this.d, 11)
    return result
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return p > 0 && this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() from an empty list')
    return items[Math.floor(this.next() * items.length)] as T
  }

  /** In-place Fisher-Yates shuffle, returned for chaining. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = items[i] as T
      items[i] = items[j] as T
      items[j] = tmp
    }
    return items
  }

  /** An independent stream derived from this stream's seed and a label. */
  fork(label: string): Rng {
    return new Rng(mix32(this.seed, hashString(label)))
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}
