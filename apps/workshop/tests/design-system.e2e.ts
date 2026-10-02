import { expect, test } from '@playwright/test'

test('failed workspace loading preserves data and offers retry or return to Features', async ({ page }) => {
  let failed = true
  let saves = 0
  await page.route('**/__workshop/session', async route => {
    if (route.request().method() === 'PUT') saves += 1
    await route.fulfill(failed
      ? { status: 400, json: { error: 'Unexpected non-whitespace character after JSON' } }
      : { json: { session: null } })
  })
  await page.route('**/__workshop/profiles', route => route.fulfill({ json: { profiles: [] } }))
  await page.goto('/features')
  await page.getByRole('link', { name: 'Design system' }).click()
  await expect(page.getByRole('heading', { name: 'Couldn’t open Design system' })).toBeVisible()
  await expect(page.getByText('Your saved session and profiles have not been changed.', { exact: false })).toBeVisible()
  expect(saves).toBe(0)
  await page.getByRole('link', { name: '← Features' }).click()
  await expect(page.getByRole('link', { name: 'Design system' })).toBeVisible()
  await page.getByRole('link', { name: 'Design system' }).click()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  failed = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Component library', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Gallery', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Initial primitive library' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Initial primitive library' })).toBeVisible()
  await page.getByRole('button', { name: 'Workbench', exact: true }).click()
  await expect(page.getByText('Component library', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '← Features' }).click()
  await expect(page.getByRole('link', { name: 'Design system' })).toBeVisible()
})

test('a profile loading failure can be retried without saving a fallback session', async ({ page }) => {
  let failed = true
  let saves = 0
  await page.route('**/__workshop/session', route => {
    if (route.request().method() === 'PUT') saves += 1

    return route.fulfill({ json: { session: null } })
  })
  await page.route('**/__workshop/profiles', route => route.fulfill(failed
    ? { status: 500, json: { error: 'Unable to read local profiles' } }
    : { json: { profiles: [] } }))
  await page.goto('/design-system/gallery')
  await expect(page.getByRole('heading', { name: 'Couldn’t open Design system' })).toBeVisible()
  expect(saves).toBe(0)
  failed = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Initial primitive library' })).toBeVisible()
})
