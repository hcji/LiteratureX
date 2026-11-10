import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

export interface ContextMenuItem {
  key?: string
  label?: string
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  onSelect?: () => void
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose
}: {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    if (!open) return
    const rect = menuRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 220
    const height = rect?.height ?? 0
    const nextX = Math.max(8, Math.min(x, window.innerWidth - width - 8))
    const nextY = Math.max(8, Math.min(y, window.innerHeight - height - 8))
    setPosition({ x: nextX, y: nextY })
  }, [open, x, y])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onClose)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[90]"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        className="absolute min-w-[218px] max-w-[300px] rounded-lg border border-border/80 bg-popover p-1 text-popover-foreground shadow-2xl"
        style={{ left: position.x, top: position.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item, index) =>
          item.separator ? (
            <div key={item.key ?? `separator-${index}`} className="my-1 h-px bg-border/70" />
          ) : (
            <button
              key={item.key ?? `${item.label ?? 'item'}-${index}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                onClose()
                item.onSelect?.()
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition',
                item.disabled
                  ? 'cursor-not-allowed opacity-40'
                  : item.danger
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground/85 hover:bg-muted'
              )}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.shortcut ? <span className="text-[9.5px] text-muted-foreground/70">{item.shortcut}</span> : null}
            </button>
          )
        )}
      </div>
    </div>,
    document.body
  )
}
