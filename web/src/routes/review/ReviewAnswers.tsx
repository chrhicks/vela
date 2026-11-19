import type { Review } from '../../../../state/review.ts'
import { Readings } from '../../components/Readings.tsx'
import styles from './ReviewAnswers.module.css'
import { detailReadings, replyLine, replyOf, replyReadings } from './words.ts'

interface ReviewAnswersProps {
  readonly review: Review
  readonly full: boolean
}

export function ReviewAnswers({ review, full }: ReviewAnswersProps) {
  return (
    <div className={styles.answers}>
      {review.models.map(model => {
        const reply = replyOf(review, model)
        const answer = reply?.outcome._tag === 'Answered' ? reply.outcome.answer : undefined

        return (
          <section key={model} className={styles.answer}>
            <h3 className={styles.model}>{model}</h3>

            <p className={styles.line}>{replyLine(reply)}</p>

            <Readings rows={full ? detailReadings(reply) : replyReadings(reply)} />

            {full && answer !== undefined ? (
              <>
                <h4 className={styles.heading}>What it sees</h4>
                <p className={styles.words}>{answer.sees}</p>

                <h4 className={styles.heading}>Suggested fix</h4>
                <p className={styles.words}>{answer.fix}</p>
              </>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
