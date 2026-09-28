import { describe, expect, it } from 'vitest'
import { SimController } from '../src/ui/controller'
import { interactiveSession, TOUR, TOUR_SEED } from '../src/ui/tour'

/** Walk the tour headlessly and report how each step ended. */
function walk() {
  const ctl = new SimController(interactiveSession(TOUR_SEED))
  const steps = TOUR.map((step) => {
    step.enter(ctl)
    const stop = step.panel === 'fuzz' ? 'none' : ctl.runHeadless(10_000)
    const candidacies = ctl.cluster.trace.filter((t) => t.kind === 'candidate').length
    return { title: step.title, stop, candidacies }
  })
  return { ctl, steps }
}

describe('guided tour', () => {
  it('reaches the end of every step: conditions in the correct runs, violations in the buggy ones', () => {
    const { steps } = walk()
    expect(steps.map((s) => s.stop)).toEqual([
      'condition',
      'condition',
      'condition',
      'condition',
      'condition',
      'condition',
      'violation',
      'violation',
      'none',
    ])
  })

  it('tells the partition story: the cut-off writes are discarded, the majority writes survive', () => {
    const ctl = new SimController(interactiveSession(TOUR_SEED))
    for (const step of TOUR.slice(0, 6)) {
      step.enter(ctl)
      ctl.runHeadless(10_000)
    }
    const cmds = ctl.cluster.nodes.map((n) => n.log.map((e) => e.cmd).join(' '))
    expect(new Set(cmds).size).toBe(1)
    expect(cmds[0]).toContain('w6')
    expect(cmds[0]).toContain('w7')
    expect(cmds[0]).not.toContain('w4')
    expect(cmds[0]).not.toContain('w5')
    expect(ctl.cluster.violation).toBeNull()
  })

  it('starts with a single candidate winning the first election', () => {
    const { steps } = walk()
    expect(steps[0]?.candidacies).toBe(1)
  })
})
