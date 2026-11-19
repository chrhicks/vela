import type { Review } from '../../../../state/review.ts'
import { Readings } from '../../components/Readings.tsx'
import styles from './Verdicts.module.css'
import { detailReadings, replyOf, replyReadings, sentenceOf } from './words.ts'

interface VerdictsProps {
  readonly review: Review
  readonly detailed: boolean
}

export function Verdicts({ review, detailed }: VerdictsProps) {
  return (
    <div className={styles.verdicts}>
      {review.models.map(model => {
        const reply = replyOf(review, model)
        const sentence = sentenceOf(reply)

        return (
          <section key={model} className={styles.verdict}>
            <h3 className={styles.model}>{model}</h3>

            {reply === undefined ? <p className={styles.sentence}>Waiting for an answer</p> : <Readings rows={detailed ? detailReadings(reply) : replyReadings(reply)} />}

            {sentence === undefined ? null : <p className={styles.sentence}>{sentence}</p>}
          </section>
        )
      })}
    </div>
  )
}
