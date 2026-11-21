import { useState } from 'react'
import { useSearchParams } from 'react-router'

import type { HorizonNight, HorizonRefusal } from '../../../../state/horizon-night.ts'
import { layersAtStart, toggled, type Layer } from '../../../../state/horizon-layers.ts'
import { cloudHours, cloudyRuns, forecastClearCell, forecastNote, withForecastClear } from '../../../../state/horizon-clouds.ts'
import { clampedTo, clockIn, lastNightsWords, nightFacts, nightSpan, startingTime } from '../../../../state/horizon-view.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Statement } from '../../components/Statement.tsx'
import { useLocalNow } from '../../rig/clock.ts'
import { forecastReading } from '../../rig/forecast.ts'
import { horizonNight } from '../../rig/horizon-night.ts'
import { serviceNow } from '../../rig/service-clock.ts'
import { useLink } from '../../rig/store.ts'
import { useAsked } from '../../rig/use-asked.ts'
import { HorizonChips } from './HorizonChips.tsx'
import { HorizonChart } from './HorizonChart.tsx'
import { HorizonFacts } from './HorizonFacts.tsx'
import { HorizonSlider } from './HorizonSlider.tsx'
import styles from './HorizonPage.module.css'

const tickMilliseconds = 30_000

const refreshMilliseconds = 60_000

const pickerAddress = '/?pick'

const refusalWords = (refusal: HorizonRefusal): string => {
  switch (refusal.code) {
    case 'no-site':
      return 'The mount has not reported its site, so the night cannot be worked out yet'
    case 'no-night':
      return 'The Sun does not set or rise here at this time of year, so there is no night to draw'
    case 'unknown-target':
      return 'That target is not in the catalog'
    case 'malformed':
      return 'Vela could not read that request'
  }
}

const darkWords = (night: HorizonNight, clock: (at: number) => string) =>
  night.times.darkAt === null || night.times.darkEndsAt === null ? 'No full dark' : `Dark ${clock(night.times.darkAt)} to ${clock(night.times.darkEndsAt)}`

function NightBody({ night, now, tick }: { readonly night: HorizonNight; readonly now: number | undefined; readonly tick: number }) {
  const [chosen, setChosen] = useState(() => startingTime(night, now))
  const [layers, setLayers] = useState(layersAtStart)
  const selected = clampedTo(nightSpan(night), chosen)
  const clock = clockIn(night.zone)
  const answer = useAsked(() => forecastReading(night.at), night.night, Math.floor(tick / refreshMilliseconds))
  const forecast = answer?.status === 'forecast' ? answer.forecast : undefined
  const clouds = cloudHours(nightSpan(night), forecast)
  const cloudyPercent = forecast?.cloudyPercent
  const cloudy = cloudyPercent === undefined ? [] : cloudyRuns(clouds, cloudyPercent)
  const sweeps = lastNightsWords(night.horizon.sweepNights)

  return (
    <Page width="wide">
      <PageHeader title={night.target.name} facts={[...(night.target.commonName === null ? [] : [night.target.commonName]), `Night of ${night.night.slice('0000-'.length)}`, darkWords(night, clock), ...(sweeps === undefined ? [] : [sweeps])]}>
        <ActionLink to={pickerAddress}>Other target</ActionLink>
        <PillLink to={`/?target=${encodeURIComponent(night.target.id)}`}>Start</PillLink>
      </PageHeader>

      <div className={styles.night}>
        <HorizonFacts cells={withForecastClear(nightFacts(night, clock), cloudyPercent === undefined ? undefined : forecastClearCell(night, clouds, cloudyPercent))} />

        {night.facts.clear === null ? <Statement size="instruction">{`${night.target.name} never clears the horizon in the dark tonight`}</Statement> : null}

        <HorizonChips layers={layers} cloudNote={answer === undefined ? undefined : forecastNote(forecast, clouds)} onToggle={(layer: Layer) => setLayers(current => toggled(current, layer))} />

        <HorizonChart night={night} now={now} selected={selected} layers={layers} cloudy={cloudy} />

        <HorizonSlider night={night} now={now} selected={selected} layers={layers} clouds={clouds} onSelect={setChosen} />
      </div>
    </Page>
  )
}

function NightView({ target }: { readonly target: string }) {
  const tick = useLocalNow(tickMilliseconds)
  const now = serviceNow(useLink(), tick)
  const reading = useAsked(() => horizonNight(target), target, Math.floor(tick / refreshMilliseconds))

  if (reading === undefined) return null

  if (reading.status !== 'night') {
    return (
      <Page width="wide">
        <PageHeader title="Horizon" facts={[]}>
          <ActionLink to={pickerAddress}>Other target</ActionLink>
        </PageHeader>

        <Statement size="instruction">{reading.status === 'refused' ? refusalWords(reading.refusal) : 'Vela did not answer'}</Statement>
      </Page>
    )
  }

  return <NightBody night={reading.night} now={now} tick={tick} />
}

export function HorizonPage() {
  const [search] = useSearchParams()
  const target = search.get('target')

  if (target === null) {
    return (
      <Page width="wide">
        <PageHeader title="Horizon" facts={[]}>
          <ActionLink to={pickerAddress}>Pick a target</ActionLink>
        </PageHeader>

        <Statement size="instruction">No target chosen</Statement>
      </Page>
    )
  }

  return <NightView key={target} target={target} />
}
