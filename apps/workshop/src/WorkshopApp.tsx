import { useEffect, useState } from 'react'
import { App } from './App'
import { FeatureWorkspace } from './feature-workspace/FeatureWorkspace'
import { isDesignSystemLocation } from './feature-workspace/location'

export function WorkshopApp() {
  const [url, setUrl] = useState(() => new URL(window.location.href))

  useEffect(() => {
    const readLocation = () => setUrl(new URL(window.location.href))
    window.addEventListener('popstate', readLocation)

    return () => window.removeEventListener('popstate', readLocation)
  }, [])

  if (isDesignSystemLocation(url)) return <App />

  function navigate(href: string, replace = false) {
    if (replace) window.history.replaceState(null, '', href)
    else window.history.pushState(null, '', href)

    setUrl(new URL(window.location.href))
  }

  return <FeatureWorkspace url={url} navigate={navigate} />
}
