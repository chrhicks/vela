import type { Reviews } from '../../../../state/review.ts'
import { clockTime } from '../../rig/clock.ts'
import styles from './Strip.module.css'
import { replyOf, summaryOf, verdictOf } from './words.ts'

interface StripProps {
  readonly reviews: Reviews
  readonly models: ReadonlyArray<string>
}

export function Strip({ reviews, models }: StripProps) {
  return (
    <section className={styles.strip} aria-label="Every frame tonight, oldest first">
      {models.map(model => (
        <div key={model} className={styles.row}>
          <span className={styles.model}>{model}</span>

          <span className={styles.cells}>
            {reviews.map(review => {
              const reply = replyOf(review, model)
              const verdict = verdictOf(reply)
              const title = `${clockTime(review.at)}: ${summaryOf(reply)}`

              return <a key={review.id} href={`#${review.id}`} className={`${styles.cell} ${styles[verdict]}`} title={title} aria-label={title} />
            })}
          </span>
        </div>
      ))}
    </section>
  )
}
