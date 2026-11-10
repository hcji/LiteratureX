import * as React from 'react'
import { cn } from '../../lib/utils'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger' | 'accent'

const variants: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary border-primary/20',
  secondary: 'bg-muted text-muted-foreground border-border',
  outline: 'border-border text-muted-foreground',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25',
  accent: 'bg-accent text-accent-foreground border-primary/20'
}

export function Badge({
  className,
  variant = 'default',
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function Dot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color ?? 'var(--muted-foreground)' }}
    />
  )
}
