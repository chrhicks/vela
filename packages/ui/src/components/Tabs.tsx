import { useId, useRef, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'

export interface TabItem {
  id: string
  label: ReactNode
  content: ReactNode
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: readonly TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  className = '',
  ...props
}: TabsProps) {
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const fallback = defaultValue ?? items[0]?.id ?? ''
  const [internalValue, setInternalValue] = useState(fallback)
  const selectedValue = value ?? internalValue
  const selected = items.find(item => item.id === selectedValue) ?? items[0]

  function select(next: string) {
    if (value === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  return (
    <div className={`vela-tabs ${className}`.trim()} {...props}>
      <div className="vela-tabs__list" role="tablist">
        {items.map((item, index) => (
          <button
            role="tab"
            id={`${id}-tab-${item.id}`}
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={item.id === selected?.id}
            tabIndex={item.id === selected?.id ? 0 : -1}
            ref={element => { buttons.current[index] = element }}
            data-active={item.id === selected?.id}
            onKeyDown={event => {
              let next = index

              if (event.key === 'ArrowRight') next = (index + 1) % items.length
              else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length
              else if (event.key === 'Home') next = 0
              else if (event.key === 'End') next = items.length - 1
              else return
              event.preventDefault()
              select(items[next]!.id)
              buttons.current[next]?.focus()
            }}
            key={item.id}
            onClick={() => select(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {selected ? (
        <div className="vela-tabs__panel" role="tabpanel" id={`${id}-panel-${selected.id}`} aria-labelledby={`${id}-tab-${selected.id}`} tabIndex={0}>
          {selected.content}
        </div>
      ) : null}
    </div>
  )
}
