import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function PageHeader({
  title,
  subtitle,
  actions,
  className
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-start justify-between gap-4 border-b border-border/70 bg-background/80 px-6 pb-3 pt-4 backdrop-blur',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  )
}

export function PanelHeader({
  title,
  actions,
  className
}: {
  title: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3.5', className)}>
      <div className="truncate text-[12.5px] font-semibold text-foreground">{title}</div>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  )
}
