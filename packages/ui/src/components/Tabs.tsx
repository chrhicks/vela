import { useState } from 'react'
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
  size?: 'small' | 'medium'
}

export function Tabs({ items, value, defaultValue, onValueChange, size = 'medium', className = '', ...props }: TabsProps) {
  const fallback = defaultValue ?? items[0]?.id ?? ''
  const [internalValue, setInternalValue] = useState(fallback)
  const selectedValue = value ?? internalValue
  const selected = items.find((item) => item.id === selectedValue) ?? items[0]

  function select(next: string) {
    if (value === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  return (
    <div className={`vela-tabs ${className}`.trim()} data-size={size} {...props}>
      <div className="vela-tabs__list">
        {items.map((item) => (
          <button data-active={item.id === selected?.id} key={item.id} onClick={() => select(item.id)} type="button">
            {item.label}
          </button>
        ))}
      </div>
      {selected ? <div className="vela-tabs__panel">{selected.content}</div> : null}
    </div>
  )
}
