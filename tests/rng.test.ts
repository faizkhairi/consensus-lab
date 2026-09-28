import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { hashString, mix32, Rng } from '../src/sim/rng'

const draw = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.nextU32())

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(draw(new Rng(42), 100)).toEqual(draw(new Rng(42), 100))
  })

  it('produces different sequences for different seeds', () => {
    expect(draw(new Rng(1), 20)).not.toEqual(draw(new Rng(2), 20))
  })

  it('handles a seed of zero', () => {
    const values = draw(new Rng(0), 50)
    expect(new Set(values).size).toBeGreaterThan(45)
  })

  it('forks streams that depend only on the parent seed and the label', () => {
    const parent = new Rng(7)
    const before = draw(parent.fork('net'), 10)
    draw(parent, 1000) // drawing from the parent must not move its forks
    expect(draw(parent.fork('net'), 10)).toEqual(before)
    expect(draw(parent.fork('timers'), 10)).not.toEqual(before)
  })

  it('keeps floats in [0, 1) and ranges inside their bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer({ min: -50, max: 50 }), (seed, lo) => {
        const rng = new Rng(seed)
        for (let i = 0; i < 200; i++) {
          const f = rng.next()
          expect(f).toBeGreaterThanOrEqual(0)
          expect(f).toBeLessThan(1)
          const r = rng.range(lo, lo + 10)
          expect(r).toBeGreaterThanOrEqual(lo)
          expect(r).toBeLessThan(lo + 10)
          const n = rng.int(lo, lo + 3)
          expect(Number.isInteger(n)).toBe(true)
          expect(n).toBeGreaterThanOrEqual(lo)
          expect(n).toBeLessThanOrEqual(lo + 3)
        }
      }),
    )
  })

  it('reaches both ends of an inclusive integer range', () => {
    const rng = new Rng(3)
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(1, 4)))
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('does not consume a draw for chance(0), so disabling a fault keeps the rest of the run identical', () => {
    const a = new Rng(9)
    const b = new Rng(9)
    expect(a.chance(0)).toBe(false)
    expect(a.nextU32()).toBe(b.nextU32())
    expect(new Rng(9).chance(1)).toBe(true)
  })

  it('shuffles into a permutation and picks members', () => {
    const rng = new Rng(11)
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    expect([...rng.shuffle([...items])].sort()).toEqual(items)
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items))
    expect(() => rng.pick([])).toThrow()
  })

  it('hashes and mixes to unsigned 32-bit integers', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).not.toBe(hashString('b'))
    const m = mix32(1, 2)
    expect(m).toBeGreaterThanOrEqual(0)
    expect(m).toBeLessThanOrEqual(0xffffffff)
    expect(mix32(1, 2)).not.toBe(mix32(2, 1))
  })
})
