import { describe, expect, it } from 'vitest'
import { PINNED } from '../src/sim/scenarios'
import { SimController, VIRTUAL_MS_PER_SECOND } from '../src/ui/controller'
import { interactiveSession, replaySession } from '../src/ui/tour'
import { fingerprint } from './helpers'

describe('SimController', () => {
  it('advances virtual time in slow motion, scaled by speed, only while playing', () => {
    const ctl = new SimController(interactiveSession(1))
    ctl.tick(1000)
    expect(ctl.cluster.now).toBe(0)
    ctl.play()
    ctl.tick(1000)
    expect(ctl.cluster.now).toBeCloseTo(VIRTUAL_MS_PER_SECOND)
    ctl.setSpeed(4)
    ctl.tick(500)
    expect(ctl.cluster.now).toBeCloseTo(VIRTUAL_MS_PER_SECOND * 3)
  })

  it('notifies subscribers on every change', () => {
    const ctl = new SimController(interactiveSession(1))
    let calls = 0
    const unsubscribe = ctl.subscribe(() => calls++)
    const before = ctl.getVersion()
    ctl.stepOnce()
    ctl.toggle()
    ctl.toggle()
    expect(calls).toBe(3)
    expect(ctl.getVersion()).toBe(before + 3)
    unsubscribe()
    ctl.stepOnce()
    expect(calls).toBe(3)
  })

  it('travels back and forward in time to the identical state', () => {
    const ctl = new SimController(interactiveSession(3))
    ctl.seekTime(1500)
    ctl.act({ type: 'write' })
    ctl.seekTime(3000)
    const at3000 = fingerprint(ctl.cluster)
    ctl.seekTime(400)
    expect(ctl.cluster.now).toBe(400)
    expect(ctl.horizon).toBe(3000)
    ctl.seekTime(3000)
    expect(fingerprint(ctl.cluster)).toBe(at3000)
  })

  it('discards the old future when acting in the past', () => {
    const ctl = new SimController(interactiveSession(3))
    ctl.seekTime(1000)
    ctl.act({ type: 'write' })
    ctl.seekTime(2000)
    ctl.act({ type: 'write' })
    expect(ctl.session.recorded).toHaveLength(2)
    ctl.seekTime(1500)
    ctl.act({ type: 'crashLeader' })
    expect(ctl.session.recorded.map((r) => r.action.type)).toEqual(['write', 'crashLeader'])
    expect(ctl.horizon).toBe(1500)
  })

  it('restores a snapshot exactly', () => {
    const ctl = new SimController(interactiveSession(5))
    ctl.seekTime(900)
    for (let i = 0; i < 3; i++) ctl.stepOnce()
    const snap = ctl.snapshot()
    const expected = fingerprint(ctl.cluster)
    ctl.act({ type: 'write' })
    ctl.seekTime(2500)
    ctl.restore(snap)
    expect(fingerprint(ctl.cluster)).toBe(expected)
    expect(ctl.session.recorded).toHaveLength(0)
  })

  it('pauses on a new violation and can play on past it', () => {
    const fuzzCase = PINNED.skipUpToDateCheck
    const ctl = new SimController(replaySession(fuzzCase), { time: 1000, horizon: fuzzCase.duration })
    expect(ctl.horizonTrace.some((t) => t.kind === 'violation')).toBe(true)
    ctl.play()
    expect(ctl.runHeadless(5000)).toBe('violation')
    expect(ctl.cluster.violation?.invariant).toBe('leaderCompleteness')
    const at = ctl.cluster.now
    ctl.play()
    ctl.runHeadless(200)
    expect(ctl.cluster.now).toBeGreaterThan(at)
  })

  it('stops a headless run at its limit when the condition never holds', () => {
    const ctl = new SimController(interactiveSession(1))
    ctl.playUntil(() => false)
    expect(ctl.runHeadless(300)).toBe('limit')
    expect(ctl.playing).toBe(false)
    expect(ctl.cluster.now).toBeCloseTo(300)
  })
  describe('stepBack', () => {
    const state = (ctl: SimController) =>
      JSON.stringify({
        events: ctl.cluster.eventCount,
        trace: ctl.cluster.trace,
        nodes: ctl.cluster.nodes.map((n) => [n.currentTerm, n.votedFor, n.role, n.commitIndex, n.log]),
      })

    it('undoes exactly one event and pauses', () => {
      const ctl = new SimController(interactiveSession(3))
      const reference = new SimController(interactiveSession(3))
      for (let i = 0; i < 40; i++) ctl.stepOnce()
      for (let i = 0; i < 39; i++) reference.stepOnce()
      const undoneAt = ctl.cluster.lastEventTime
      ctl.play()
      ctl.stepBack()
      expect(ctl.playing).toBe(false)
      expect(ctl.cluster.eventCount).toBe(39)
      expect(state(ctl)).toBe(state(reference))
      expect(ctl.cluster.now).toBe(undoneAt)
      ctl.stepOnce()
      expect(ctl.cluster.eventCount).toBe(40)
    })

    it('keeps an operator action taken just before the undone event', () => {
      const ctl = new SimController(interactiveSession(3))
      while (ctl.cluster.leader === null) ctl.stepOnce()
      ctl.act({ type: 'write' })
      ctl.stepOnce()
      ctl.stepBack()
      expect(ctl.cluster.recorded).toHaveLength(1)
      expect(ctl.cluster.stats.writes).toBe(1)
      // Acting again must not treat the write as an abandoned future and drop it.
      ctl.act({ type: 'write' })
      expect(ctl.session.recorded).toHaveLength(2)
      expect(ctl.cluster.stats.writes).toBe(2)
    })

    it('does nothing before the first event', () => {
      const ctl = new SimController(interactiveSession(3))
      const before = state(ctl)
      ctl.stepBack()
      expect(state(ctl)).toBe(before)
      expect(ctl.cluster.eventCount).toBe(0)
    })

    it('steps back across a violation, which then clears', () => {
      const fuzzCase = PINNED.skipUpToDateCheck
      const ctl = new SimController(replaySession(fuzzCase), { time: 1000, horizon: fuzzCase.duration })
      ctl.play()
      expect(ctl.runHeadless(5000)).toBe('violation')
      ctl.stepBack()
      expect(ctl.cluster.violation).toBeNull()
      ctl.stepOnce()
      expect(ctl.cluster.violation?.invariant).toBe('leaderCompleteness')
    })
  })
})
