import { latestReview } from '../../../../state/review.ts'
import { reviewPath } from '../../../../state/review-answer.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { clockTime } from '../../rig/clock.ts'
import { useRig } from '../../rig/store.ts'
import styles from './LatestReview.module.css'
import { Verdicts } from './Verdicts.tsx'

export function LatestReview() {
  const review = useRig(rig => latestReview(rig.reviews))

  if (review === undefined) return null

  return (
    <section className={styles.latest}>
      <h2 className={styles.heading}>Is the frame obstructed?</h2>

      <p className={styles.why}>Newest frame · asked {clockTime(review.at)}</p>

      <Verdicts review={review} detailed={false} />

      <ActionLink to={reviewPath}>All frames tonight</ActionLink>
    </section>
  )
}
