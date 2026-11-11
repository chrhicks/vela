import { Link, useLocation } from 'react-router'

import styles from './SceneBar.module.css'
import { sections } from './scenes.ts'

export function SceneBar() {
  const location = useLocation()
  const section = sections.find(candidate => location.pathname.startsWith(candidate.root))

  if (section === undefined) return null

  const here = `${location.pathname}${location.search}`

  return (
    <nav className={styles.bar} aria-label="Stub scenes">
      <span className={styles.name}>Stub</span>

      {section.scenes.map(scene => (
        <Link key={scene.to} to={scene.to} className={scene.to === here ? styles.here : styles.scene}>
          {scene.label}
        </Link>
      ))}
    </nav>
  )
}
