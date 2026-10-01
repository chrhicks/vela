import { Button, Checkbox, Input, Select } from '@vela/ui'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { captureActivity, useCapture } from '../features/capture/use-capture'
import { PreparationCooling } from '../features/capture/PreparationCooling'
import { useImagingCamera } from '../features/imaging-camera/use-imaging-camera'
import { EquipmentSummary } from '../features/observation/EquipmentSummary'
import { RigReadiness } from '../features/observation/RigReadiness'
import { useObservation } from '../features/observation/use-observation'
import { FramingExposure } from '../features/targets/FramingExposure'
import { useFraming } from '../features/targets/use-framing'
import { useTonightTarget } from '../features/targets/use-tonight-target'
import './capture.css'
import './observe.css'
import './preparation.css'

export function Observe() {
  const { rigId = '' } = useParams()

  return <Preparation key={rigId} rigId={rigId} />
}

function Preparation({ rigId }: { rigId: string }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const targetId = params.get('target') ?? undefined
  const target = useTonightTarget(rigId, targetId)
  const observation = useObservation(rigId)
  const framing = useFraming(rigId)
  const camera = useImagingCamera(rigId)
  const capture = useCapture(rigId)
  const [choice, setChoice] = useState<{ id: string; name: string } | null>(null)
  const [exposure, setExposure] = useState<string | null>(null)
  const [repeat, setRepeat] = useState<boolean | null>(null)
  const [saveFrames, setSaveFrames] = useState<boolean | null>(null)
  const { view } = capture
  const base = `/rigs/${encodeURIComponent(rigId)}`
  const selected = camera.view?.selected
  const draft = choice ?? selected
  const dirty = !!choice && (choice.id !== selected?.id || choice.name !== selected?.name)

  const validChoice = camera.view?.cameras.find(
    item => item.id === draft?.id && item.name === draft?.name && item.name !== null,
  )

  const connecting =
    observation.connecting || observation.view?.connectionPreparation.state === 'in-progress'

  const cameraLocked =
    camera.offline || camera.pending || camera.unconfirmed || connecting || !camera.view?.editable

  const secondsText = exposure ?? String(view?.exposureSeconds ?? 180)
  const seconds = Number(secondsText)

  const validSeconds =
    secondsText.trim() !== '' && Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600

  const repeatValue = repeat ?? view?.repeat ?? true
  const saveValue = saveFrames ?? view?.saveFrames ?? false

  const canStart =
    capture.canStart &&
    validSeconds &&
    !dirty &&
    !cameraLocked &&
    !!validChoice &&
    !observation.interrupted &&
    !observation.commandUnconfirmed &&
    (!targetId || !!target.target)

  const preview = framing.view?.preview && (!targetId || framing.view.preview.targetId === targetId)
    ? framing.view.preview
    : null

  const activity = !view
    ? 'Checking camera…'
    : !capture.offline && view.enabled && view.phase === 'idle'
      ? 'Camera idle'
      : captureActivity(view, capture.offline)

  const needsPreparation =
    !observation.view ||
    observation.view.connectionPreparation.state !== 'complete' ||
    observation.interrupted ||
    observation.commandUnconfirmed ||
    !!observation.result

  useEffect(() => {
    if (camera.confirmedSaves > 0) {
      setChoice(null)
      void capture.refresh()
    }
    // Refresh readiness after a confirmed selection, never start a capture as a side effect.
  }, [camera.confirmedSaves])

  async function start() {
    if (!canStart) return
    const accepted = await capture.start(seconds, repeatValue, saveValue, targetId)

    if (accepted && accepted.phase !== 'failed') navigate(`${base}/observe/capture`)
  }

  return (
    <section className="capture-preparation" aria-label="Prepare a capture">
      <div className="capture-preparation__columns">
        <FramingExposure preview={preview} />
        <div className="capture-preparation__settings">
          <header className="tonight-subject">
            <div className="tonight-context__heading">
              <span>Your subject</span>
              <Link className="tonight-link" to={`${base}/observe/targets`}>Change target</Link>
            </div>
            <h1 className="vela-type-subject">
              {target.target?.name ?? (targetId ? 'Loading your subject…' : 'Prepare a capture')}
            </h1>
            <p>
              {target.target
                ? [target.target.catalog, target.target.constellation, target.target.kind].filter(Boolean).join(' · ')
                : targetId
                  ? 'The selected catalog subject is being checked.'
                  : 'Choose a subject, or capture the current field.'}
            </p>
            {target.stale && (
              <p role="status">
                Subject details are unavailable. The requested subject has not changed.
              </p>
            )}
          </header>

          <form
            className="capture-preparation__form"
            aria-label="Capture settings"
            onSubmit={event => {
              event.preventDefault()
              void start()
            }}
          >
            <header>
              <h2>Capture settings</h2>
              <span>{activity}</span>
            </header>
            <div className="capture-preparation__field">
              <label htmlFor="preparation-camera">Imaging camera</label>
              <Select
                id="preparation-camera"
                value={validChoice?.id ?? ''}
                disabled={cameraLocked}
                options={[
                  { value: '', label: 'Choose a camera', disabled: true },
                  ...(camera.view?.cameras ?? []).map(item => ({
                    value: item.id,
                    label: item.name ?? `${item.configuredName} · unavailable`,
                    disabled: item.name === null,
                  })),
                ]}
                onChange={event => {
                  const next = camera.view?.cameras.find(item => item.id === event.target.value)

                  if (next?.name) setChoice({ id: next.id, name: next.name })
                }}
              />
            </div>
            {(dirty || !selected) && (
              <div className="capture-preparation__camera-save">
                <p>Save this camera choice before starting.</p>
                <Button
                  type="button"
                  pending={camera.pending}
                  disabled={(cameraLocked && !camera.pending) || !validChoice}
                  onClick={() => {
                    if (validChoice?.name)
                      void camera.save({ id: validChoice.id, name: validChoice.name })
                  }}
                >
                  {camera.pending ? 'Saving camera…' : 'Use this camera'}
                </Button>
              </div>
            )}
            {(camera.error || camera.offline || camera.view?.state === 'changed' || camera.view?.state === 'missing') && (
              <div role="status">
                <p>
                  {camera.error ?? (camera.offline
                    ? 'The saved camera could not be checked.'
                    : 'The saved camera identity has changed or is missing. Confirm the camera before starting.')}
                </p>
                <Button
                  type="button"
                  disabled={camera.pending}
                  onClick={() => void camera.refresh()}
                >
                  Check saved camera
                </Button>
              </div>
            )}
            {camera.view && !camera.view.editable && !view?.active && (
              <p role="status">
                Another rig operation is in progress. Camera selection is unavailable until it finishes.
              </p>
            )}

            <div className="capture-preparation__field">
              <label htmlFor="preparation-exposure">Exposure time</label>
              <div className="capture-preparation__unit-field">
                <Input
                  id="preparation-exposure"
                  type="number"
                  min="0.1"
                  max="600"
                  step="0.1"
                  value={secondsText}
                  disabled={!!view?.active || capture.pending}
                  invalid={!validSeconds}
                  onChange={event => setExposure(event.target.value)}
                />
                <span>seconds</span>
              </div>
            </div>
            {!validSeconds && <p role="status">Choose an exposure from 0.1 to 600 seconds.</p>}
            <div className="capture-preparation__options">
              <Checkbox
                label="Repeat until I stop"
                checked={repeatValue}
                disabled={!!view?.active || capture.pending}
                onChange={event => setRepeat(event.target.checked)}
              />
              <Checkbox
                label="Save every exposure"
                checked={saveValue}
                disabled={!!view?.active || capture.pending}
                onChange={event => setSaveFrames(event.target.checked)}
              />
            </div>
            {view?.active ? (
              <Link className="vela-button" data-tone="accent" to={`${base}/observe/capture`}>
                Open active capture →
              </Link>
            ) : (
              <Button
                type="submit"
                tone="accent"
                pending={capture.pending}
                disabled={!canStart && !capture.pending}
              >
                {capture.pending ? 'Starting…' : 'Start capture'}
              </Button>
            )}
            {(capture.error || view?.error || view?.unavailableReason || capture.offline) && (
              <p role="status">
                {capture.error ?? view?.error ?? view?.unavailableReason ?? 'Capture state is unavailable. Waiting for a fresh observation.'}
              </p>
            )}
            {capture.commandUnconfirmed && (
              <Button
                type="button"
                disabled={capture.pending || capture.refreshing}
                onClick={() => void capture.refresh()}
              >
                Check capture state
              </Button>
            )}
          </form>

          <PreparationCooling
            cooling={view?.cooling ?? null}
            disabled={!capture.canCool && !capture.coolingPending}
            pending={capture.coolingPending}
            checking={capture.refreshing}
            error={capture.coolingError}
            unconfirmed={capture.coolingUnconfirmed}
            runActive={view?.active}
            onCooler={value => void capture.setCooler(value)}
            onSetpoint={value => void capture.setCoolingTemperature(value)}
            onCheck={() => void capture.refresh()}
            autofocusHref={`${base}/observe/autofocus`}
          />
        </div>
      </div>

      <EquipmentSummary
        rigId={rigId}
        rigName={observation.view?.rig.name ?? view?.rigName ?? 'Current rig'}
        cooling={view?.cooling ?? null}
        coolingStale={capture.offline || capture.coolingUnconfirmed}
        coolingAction={(
          <Link className="tonight-link" to={`${base}/observe/alignment`}>Polar alignment</Link>
        )}
      />
      {needsPreparation && (
        <div className="capture-preparation__readiness">
          {observation.view ? (
            <RigReadiness observation={observation} />
          ) : (
            <div role="status">
              <h2>
                {observation.error === 'not-found'
                  ? 'Rig not found'
                  : observation.error
                    ? 'Could not load this Rig'
                    : 'Checking Rig readiness…'}
              </h2>
              {observation.error && (
                <Button disabled={observation.refreshing} onClick={() => void observation.refresh()}>
                  Check Rig again
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
