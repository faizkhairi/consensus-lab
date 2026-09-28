/**
 * Binary min-heap. The comparator must define a strict total order so that
 * pop() order is fully deterministic (the scheduler breaks time ties with a
 * monotonically increasing sequence number).
 */
export class MinHeap<T> {
  private items: T[] = []

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length
  }

  peek(): T | undefined {
    return this.items[0]
  }

  push(item: T): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(items[i] as T, items[parent] as T)) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): T | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0] as T
    const last = items.pop() as T
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        if (l < items.length && this.less(items[l] as T, items[smallest] as T)) smallest = l
        if (r < items.length && this.less(items[r] as T, items[smallest] as T)) smallest = r
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private swap(i: number, j: number): void {
    const tmp = this.items[i] as T
    this.items[i] = this.items[j] as T
    this.items[j] = tmp
  }
}
