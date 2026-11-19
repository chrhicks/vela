import { latestReview } from '../../../../state/review.ts'
import { reviewPath } from '../../../../state/review-answer.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { clockTime } from '../../rig/clock.ts'
import { useRig } from '../../rig/store.ts'
import styles from './LatestReview.module.css'
import { ReviewAnswers } from './ReviewAnswers.tsx'
import { reasonsWords } from './words.ts'

export function LatestReview() {
  const review = useRig(rig => latestReview(rig.reviews))

  if (review === undefined) return null

  return (
    <section className={styles.latest}>
      <h2 className={styles.heading}>Why the stats changed</h2>

      <p className={styles.why}>
        {clockTime(review.at)} · {reasonsWords(review)}
      </p>

      <ReviewAnswers review={review} full={false} />

      <ActionLink to={reviewPath}>All reviews tonight</ActionLink>
    </section>
  )
}
