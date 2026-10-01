import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createExploreScene, type ExploreScene } from './explore'
import { reviewResources } from './resources'

const resources = new Map(reviewResources.map(resource => {
  const body = readFileSync(new URL(`../../../../../${resource.path}`, import.meta.url))

  if (createHash('sha256').update(body).digest('hex') !== resource.sha256)
    throw new Error(`Review resource hash changed: ${resource.resource}`)

  return [resource.resource, { body, contentType: resource.contentType }]
}))

export async function openExploreScene(page: Page, name: ExploreScene) {
  const scene = createExploreScene(name)
  const requests: string[] = []
  const missingResources: string[] = []
  await page.clock.setFixedTime(new Date(scene.time))
  await page.addInitScript(mode => localStorage.setItem('vela.appearance', mode), scene.appearance)
  await page.route('**/api/**', route => {
    const request = route.request()
    const url = new URL(request.url())
    requests.push(`${request.method()} ${url.pathname}${url.search}`)

    const result = scene.respond(request.method(), `${url.pathname}${url.search}`,
      request.postData() ? request.postDataJSON() : undefined)

    const resource = result.resource ? resources.get(result.resource) : undefined

    // Aladin probes optional MOC coverage; production also rejects that path.
    if (url.pathname.startsWith('/api/survey/') && url.pathname !== '/api/survey/dss2/Moc.fits' && result.status !== 200) missingResources.push(url.pathname)

    if (result.resource && !resource) throw new Error(`Unmapped review resource ${result.resource}`)

    return resource
      ? route.fulfill({ status: result.status, contentType: resource.contentType, body: resource.body })
      : route.fulfill({ status: result.status, json: result.json })
  })
  await page.goto(scene.route)

  return { scene, requests, missingResources }
}
