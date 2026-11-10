import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variantClasses: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  secondary: 'bg-muted text-foreground hover:bg-muted/70',
  outline: 'border border-border bg-transparent hover:bg-muted/60',
  ghost: 'bg-transparent hover:bg-muted/70',
  destructive: 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
  link: 'bg-transparent text-primary underline-offset-4 hover:underline p-0 h-auto'
}

const sizeClasses: Record<Size, string> = {
  xs: 'h-7 px-2 text-[11px] gap-1',
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
  icon: 'h-8 w-8',
  'icon-sm': 'h-7 w-7'
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(
          'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          variant !== 'link' && sizeClasses[size],
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'
