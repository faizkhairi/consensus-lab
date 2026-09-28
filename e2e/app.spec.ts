import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Page } from '@playwright/test'
import { PINNED } from '../src/sim/scenarios'
import { encodeRun } from '../src/sim/session'
import { replaySession } from '../src/ui/tour'

const invariant = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title })

// Every test fails if the page logs an error or throws.
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await use(errors)
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})

test('elects a leader on the landing page', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle(/consensus-lab/)
  await expect(page.getByRole('img', { name: /is leader of term \d+/ })).toBeVisible({ timeout: 10_000 })
  await expect(invariant(page, 'Election Safety')).toContainText('Holds')
})

test('arrow keys and the Back button step one event at a time', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('img', { name: /Cluster of 5 servers/ })).toBeVisible()
  const eventNumber = async () =>
    Number((await page.getByText(/^event #\d+$/).textContent())?.replace('event #', ''))
  // The first step also pauses the autoplaying run.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  const start = await eventNumber()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText(`event #${start + 2}`, { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText(`event #${start + 1}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText(`event #${start}`, { exact: true })).toBeVisible()
})

test('a shared link replays the exact run, including its violation', async ({ page }) => {
  const fuzzCase = PINNED.skipUpToDateCheck
  const hash = encodeRun({ session: replaySession(fuzzCase), time: fuzzCase.duration })
  await page.goto(`./#run=${hash}`)
  await expect(invariant(page, 'Leader Completeness')).toContainText('Violated')
  await expect(invariant(page, 'Election Safety')).toContainText('Holds')
})

test('the guided tour plays a step and advances', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Take the tour' }).click()
  const tour = page.getByRole('region', { name: 'Guided tour' })
  await expect(tour).toContainText('Step 1 of 9')
  await expect(tour.getByRole('heading', { name: 'Leader election' })).toBeVisible()
  await expect(tour).toContainText('ready for the next step', { timeout: 15_000 })
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour.getByRole('heading', { name: 'Log replication' })).toBeVisible()
  await expect(tour).toContainText('Step 2 of 9')
})

test('ending the tour mid-step pauses the run', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Take the tour' }).click()
  const tour = page.getByRole('region', { name: 'Guided tour' })
  for (let step = 2; step <= 7; step++) {
    await tour.getByRole('button', { name: 'Next' }).click()
    await expect(tour).toContainText(`Step ${step} of 9`)
  }
  // Step 7 plays for several seconds of real time before its violation.
  await page.getByRole('tab', { name: 'Controls' }).click()
  // Quarter speed widens the margin before the violation on a slow runner.
  await page.getByLabel('Speed').selectOption('0.25')
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await tour.getByRole('button', { name: 'End tour' }).click()
  await expect(tour).toBeHidden()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 2_000 })
  await expect(invariant(page, 'Leader Completeness')).toContainText('Holds')
})

test('two clicks on Next before a re-render advance two steps, running each step once', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Take the tour' }).click()
  const tour = page.getByRole('region', { name: 'Guided tour' })
  await expect(tour).toContainText('ready for the next step', { timeout: 15_000 })
  // Both clicks land in one task, so React has not re-rendered between them.
  await tour.getByRole('button', { name: 'Next' }).evaluate((button: HTMLElement) => {
    button.click()
    button.click()
  })
  await expect(tour).toContainText('Step 3 of 9')
  // Step 2 sends three writes; entering it twice would send six.
  await expect(page.getByText(/^3 writes, 0 rejected$/)).toBeVisible()
})

test('the tour reaches the Figure 8 bug and the event feed shows only that run, newest first', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Take the tour' }).click()
  const tour = page.getByRole('region', { name: 'Guided tour' })
  for (let step = 2; step <= 7; step++) {
    await tour.getByRole('button', { name: 'Next' }).click()
    await expect(tour).toContainText(`Step ${step} of 9`)
  }
  await expect(tour).toContainText('the oracle caught a violation', { timeout: 20_000 })
  await expect(invariant(page, 'Leader Completeness')).toContainText('Violated')

  // Earlier steps' rows must not linger: one sim event can emit several trace entries.
  const feed = page.locator('section', { has: page.getByRole('heading', { name: 'Events' }) })
  const rows = await feed.getByRole('listitem').allTextContents()
  expect(rows[0]).toContain('became leader of term 13 without committed entry')
  const times = rows.map((row) => Number(row.match(/t=(\d+)/)?.[1]))
  expect(times.every((t, i) => i === 0 || t <= (times[i - 1] as number))).toBe(true)
  expect(rows.some((row) => row.includes('Client wrote'))).toBe(false)
})

test('the fuzzer finds, shrinks and replays a counterexample', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('tab', { name: 'Fuzzer' }).click()
  await page.getByLabel('Bug to hunt').selectOption({ label: 'Forget the vote on restart' })
  await page.getByRole('button', { name: 'Hunt' }).click()
  await expect(page.getByText(/Found a violation at seed \d+/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Shrunk from \d+ to \d+ faults/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Replay counterexample' }).click()
  await expect(invariant(page, 'Election Safety')).toContainText('Violated', { timeout: 20_000 })
})

test('has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('img', { name: /Cluster of 5 servers/ })).toBeVisible()
  const check = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.length} node(s)`)
  }
  expect(await check()).toEqual([])
  await page.getByRole('button', { name: 'Take the tour' }).click()
  await page.getByRole('tab', { name: 'Fuzzer' }).click()
  expect(await check()).toEqual([])
})
