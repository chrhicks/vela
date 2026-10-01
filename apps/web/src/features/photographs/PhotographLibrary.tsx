import type { SavedImage } from '@vela/model/web'
import { Input, Tabs } from '@vela/ui'
import { useState, type MouseEventHandler } from 'react'
import { Link } from 'react-router'
import { photographDate, photographDay, photographTime } from './format'
import { groupPhotographs, photographNight, photographNightTitle, photographTarget } from './library'
import type { PhotographBrowse, PhotographGroup } from './library'

export function PhotographGroups({
  groups,
  browse,
  query,
  timeZone,
  onBrowse,
  onSearch,
  groupHref,
  onOpen,
}: {
  groups: PhotographGroup[]
  browse: PhotographBrowse
  query: string
  timeZone: string
  onBrowse: (browse: PhotographBrowse) => void
  onSearch: (query: string) => void
  groupHref: (group: string) => string
  onOpen: MouseEventHandler<HTMLAnchorElement>
}) {
  const byNight = browse === 'nights'

  const matching = groups.filter(group => {
    const terms = [group.title, ...group.images.flatMap(image => [
      image.subject?.name ?? 'No recorded target',
      image.subject?.catalog ?? '',
      photographNightTitle(photographNight(image.capturedAt, timeZone)),
      photographDay(`${photographNight(image.capturedAt, timeZone)}T12:00:00Z`, 'UTC'),
    ])]

    return terms.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  })

  const content = (
    <>
      <div className="photographs__search">
        <Input
          label={byNight ? 'Find a night or target' : 'Find a target'}
          type="search"
          placeholder={byNight ? 'September, Crescent…' : 'M31, Crescent…'}
          value={query}
          onChange={event => onSearch(event.target.value)}
        />
        <span role="status">
          {matching.length} {browse} · {matching.reduce((total, group) => total + group.images.length, 0)} photographs
        </span>
      </div>
      <div className="photographs__groups">
        {matching.map(group => {
          const related = groupPhotographs(group.images, byNight ? 'targets' : 'nights', timeZone)
          const recordedCount = byNight ? related.filter(item => item.id !== 'unrecorded').length : related.length
          const relatedKind = byNight ? 'recorded target' : 'night'
          const cover = group.images[0]!

          return (
            <Link className="photographs__group" key={group.id} to={groupHref(group.id)} onClick={onOpen}>
              <PhotographThumbnail key={cover.fitImageUrl ?? cover.imageUrl} image={cover} />
              <div>
                <h2>{group.title}</h2>
                <p>{group.images.length} photographs · {recordedCount} {relatedKind}{recordedCount === 1 ? '' : 's'}</p>
                <p>{related.map(item => item.title).join(' · ')}</p>
              </div>
              <span aria-hidden="true">→</span>
            </Link>
          )
        })}
      </div>
      {matching.length === 0 && <p className="photographs__no-match">No matching {browse}. Try a different search.</p>}
      {byNight && <p className="photographs__hint">Each night includes the following morning, through noon.</p>}
    </>
  )

  return (
    <Tabs
      value={browse}
      onValueChange={value => onBrowse(value === 'targets' ? 'targets' : 'nights')}
      items={[
        { id: 'nights', label: 'Nights', content },
        { id: 'targets', label: 'Targets', content },
      ]}
    />
  )
}

export function PhotographGrid({ images, browse, timeZone, imageHref, onOpen }: {
  images: SavedImage[]
  browse: PhotographBrowse
  timeZone: string
  imageHref: (imageId: string) => string
  onOpen: MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <section className="photographs__grid" aria-label="Photographs in group">
      {images.map(image => {
        const target = photographTarget(image)
        const date = photographDate(image.capturedAt, true, timeZone)
        const time = photographTime(image.capturedAt, timeZone)
        const nextMorning = date !== photographNightTitle(photographNight(image.capturedAt, timeZone))

        return (
          <Link
            key={image.id}
            to={imageHref(image.id)}
            aria-label={`Open ${target.title}, ${date}, ${time}`}
            onClick={onOpen}
          >
            <PhotographThumbnail key={image.fitImageUrl ?? image.imageUrl} image={image} />
            <strong>{target.title}</strong>
            <time dateTime={image.capturedAt}>
              {browse === 'targets' ? `${date} · ` : ''}{time}{browse === 'nights' && nextMorning ? ' · following morning' : ''}
            </time>
            <small>{image.exposureSeconds} s · {image.color === 'color' ? 'Color' : 'Mono'}</small>
            {image.previewRendering?.status !== 'current' && <small>Original preview</small>}
          </Link>
        )
      })}
    </section>
  )
}

function PhotographThumbnail({ image }: { image: SavedImage }) {
  const [failed, setFailed] = useState(false)

  return (
    <span className="photographs__thumbnail">
      {failed
        ? <span>Preview unavailable</span>
        : <img src={image.fitImageUrl ?? image.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}
