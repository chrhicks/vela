import { Button } from '../components/Button'
import { Input } from '../components/Input'
import type { ComponentSpecimen } from '../themes'
import { Dialog } from './Dialog'
import './Dialog.specimen.css'

interface PreviewProps {
  props: Record<string, string | number | boolean>
  onPropsChange: ((patch: Record<string, string | number | boolean>) => void) | undefined
}

function DialogPreview({ props, onPropsChange }: PreviewProps) {
  const open = Boolean(props.open)
  const title = String(props.title)
  const description = String(props.description)
  const update = (patch: Record<string, string | number | boolean>) => onPropsChange?.(patch)

  return (
    <div className="vela-dialog-specimen">
      <div className="vela-dialog-specimen__background">
        <small>Primitive preview</small>
        <h2>Dialog anatomy</h2>
        <p>The surrounding application owns the trigger and every piece of product content inside the dialog.</p>
        <Button onClick={() => update({ open: true })} tone="accent">Open dialog</Button>
      </div>

      <Dialog
        description={description}
        footer={(
          <>
            <Button onClick={() => update({ open: false })} tone="quiet">Cancel</Button>
            <Button onClick={() => update({ open: false })} tone="accent">Confirm</Button>
          </>
        )}
        onDismiss={() => update({ open: false })}
        open={open}
        title={title}
      >
        <div className="vela-dialog-specimen__body">
          <p>This content is supplied by the consuming feature. The primitive owns the modal shell, accessible labelling, dismissal, focus behavior, and responsive scrolling.</p>
          <Input label="Example field" placeholder="Feature-owned value" />
          <dl className="vela-dialog-specimen__anatomy">
            <div><dt>Header</dt><dd>Title, description, and close action</dd></div>
            <div><dt>Body</dt><dd>Arbitrary consumer content with overflow</dd></div>
            <div><dt>Footer</dt><dd>Feature-provided actions in stable chrome</dd></div>
          </dl>
        </div>
      </Dialog>
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'dialog',
  componentName: 'Dialog',
  id: 'dialog-primitive',
  name: 'Primitive anatomy',
  description: 'The reusable modal shell without product-specific layout or copy.',
  controls: {
    open: { type: 'boolean', label: 'Open' },
    title: { type: 'text', label: 'Title' },
    description: { type: 'text', label: 'Description' },
  },
  defaultProps: {
    open: true,
    title: 'Dialog title',
    description: 'A concise explanation of this temporary task.',
  },
  render: (props, onPropsChange) => <DialogPreview onPropsChange={onPropsChange} props={props} />,
}
