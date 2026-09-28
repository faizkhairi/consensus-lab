import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MinHeap } from '../src/sim/heap'

interface Item {
  readonly time: number
  readonly seq: number
}

const byTimeThenSeq = (a: Item, b: Item) => a.time < b.time || (a.time === b.time && a.seq < b.seq)

describe('MinHeap', () => {
  it('pops in (time, seq) order for any input', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 200 }), (times) => {
        const heap = new MinHeap<Item>(byTimeThenSeq)
        const items = times.map((time, seq) => ({ time, seq }))
        for (const item of items) heap.push(item)
        expect(heap.size).toBe(items.length)
        const popped: Item[] = []
        for (let item = heap.pop(); item !== undefined; item = heap.pop()) popped.push(item)
        const expected = [...items].sort((a, b) => a.time - b.time || a.seq - b.seq)
        expect(popped).toEqual(expected)
      }),
    )
  })

  it('peeks without removing and returns undefined when empty', () => {
    const heap = new MinHeap<Item>(byTimeThenSeq)
    expect(heap.peek()).toBeUndefined()
    expect(heap.pop()).toBeUndefined()
    heap.push({ time: 5, seq: 0 })
    heap.push({ time: 1, seq: 1 })
    expect(heap.peek()).toEqual({ time: 1, seq: 1 })
    expect(heap.size).toBe(2)
  })
})
