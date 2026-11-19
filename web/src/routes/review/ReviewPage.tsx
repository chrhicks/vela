import { previewAddress } from '../../../../state/frames.ts'
import { tonightsReviews } from '../../../../state/review.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { clockTime } from '../../rig/clock.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { ReviewAnswers } from './ReviewAnswers.tsx'
import styles from './ReviewPage.module.css'
import { reasonsWords, statsWords } from './words.ts'

export function ReviewPage() {
  const link = useLink()
  const all = useRig(rig => rig.reviews)
  const reviews = link.night === undefined ? [] : tonightsReviews(all, link.night)

  return (
    <Page width="wide">
      <PageHeader title="Frame reviews" facts={[`${reviews.length} tonight`, 'Report only']}>
        <ActionLink to="/">Close</ActionLink>
      </PageHeader>

      {reviews.length === 0 ? (
        <p className={styles.empty}>Nothing asked yet tonight.</p>
      ) : (
        <div className={styles.reviews}>
          {reviews.map(review => (
            <article key={review.id} className={styles.review}>
              <div className={styles.pictures}>
                <Picture label="Last good frame" detail={statsWords(review.baseline)}>
                  <img src={previewAddress({ night: review.night, file: review.goodFile })} alt="Last good frame" className={styles.image} />
                </Picture>

                <Picture label={`Asked at ${clockTime(review.at)}`} detail={`${statsWords(review.current)} · ${reasonsWords(review)}`}>
                  <img src={previewAddress({ night: review.night, file: review.file })} alt="Frame that was asked about" className={styles.image} />
                </Picture>
              </div>

              <ReviewAnswers review={review} full />
            </article>
          ))}
        </div>
      )}
    </Page>
  )
}
