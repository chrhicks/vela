import type { HomeView } from '@vela/model/web'
import { api } from '../../lib/api'
import { isHomeView } from '../../lib/view-validation'

export async function loadHome(signal?: AbortSignal): Promise<HomeView> {
  const response = await api('web/home', { signal })

  if (!isHomeView(response)) throw new Error('Invalid Home response')

  return response
}
