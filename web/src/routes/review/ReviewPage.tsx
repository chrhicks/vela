import { previewAddress } from '../../../../state/frames.ts'
import { tonightsReviews } from '../../../../state/review.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { clockTime } from '../../rig/clock.ts'
import { useLink, useRig } from '../../rig/store.ts'
import styles from './ReviewPage.module.css'
import { Strip } from './Strip.tsx'
import { Verdicts } from './Verdicts.tsx'
import { verdictOf, replyOf } from './words.ts'

export function ReviewPage() {
  const link = useLink()
  const all = useRig(rig => rig.reviews)
  const reviews = link.night === undefined ? [] : tonightsReviews(all, link.night)
  const models = reviews[0]?.models ?? []
  const obstructed = reviews.filter(review => review.models.some(model => verdictOf(replyOf(review, model)) === 'obstructed')).length

  return (
    <Page width="wide">
      <PageHeader title="Frame reviews" facts={[`${reviews.length} frames tonight`, `${obstructed} called obstructed`, 'Report only']}>
        <ActionLink to="/">Close</ActionLink>
      </PageHeader>

      {reviews.length === 0 ? (
        <p className={styles.empty}>Nothing asked yet tonight.</p>
      ) : (
        <div className={styles.reviews}>
          <Strip reviews={[...reviews].reverse()} models={models} />

          {reviews.map(review => (
            <article key={review.id} id={review.id} className={styles.review}>
              <div className={styles.picture}>
                <Picture label={`Asked at ${clockTime(review.at)}`} detail="Preview as sent">
                  <img src={previewAddress({ night: review.night, file: review.file })} alt={`Frame asked about at ${clockTime(review.at)}`} className={styles.image} />
                </Picture>
              </div>

              <Verdicts review={review} detailed />
            </article>
          ))}
        </div>
      )}
    </Page>
  )
}
