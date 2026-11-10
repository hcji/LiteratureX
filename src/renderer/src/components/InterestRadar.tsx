import { useId } from 'react'
import type { InterestTheme } from '@shared/types'
import { cn } from '../lib/utils'

function shortLabel(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

export function InterestRadar({
  themes,
  size = 248,
  className
}: {
  themes: InterestTheme[]
  size?: number
  className?: string
}) {
  const gradientId = useId().replace(/:/g, '')
  if (themes.length < 3) {
    return (
      <div className={cn('flex items-center justify-center text-[11px] text-muted-foreground', className)}>
        —
      </div>
    )
  }
  const points = themes.slice(0, 8)
  const count = points.length
  const center = size / 2
  const labelSpace = 46
  const radius = center - labelSpace
  const angle = (index: number): number => -Math.PI / 2 + (index / count) * Math.PI * 2
  const at = (index: number, value: number): [number, number] => [
    center + Math.cos(angle(index)) * radius * value,
    center + Math.sin(angle(index)) * radius * value
  ]
  const polygon = (value: number): string =>
    points.map((_, index) => at(index, value).join(',')).join(' ')
  const dataPoints = points
    .map((theme, index) => {
      const value = Math.max(0.08, Math.min(1, theme.weight))
      return at(index, value)
    })
    .map(([x, y]) => `${x},${y}`)
    .join(' ')
  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Research interest radar"
      className={cn('shrink-0 overflow-visible', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <g className="text-primary">
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={polygon(ring)}
            fill="none"
            stroke="currentColor"
            strokeOpacity={ring === 1 ? 0.28 : 0.12}
            strokeWidth={ring === 1 ? 1.1 : 0.8}
          />
        ))}
        {points.map((theme, index) => {
          const [x, y] = at(index, 1)
          return (
            <line
              key={`axis-${theme.id}-${index}`}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeWidth={0.8}
            />
          )
        })}
        <polygon
          points={dataPoints}
          fill={`url(#${gradientId})`}
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {points.map((theme, index) => {
          const [x, y] = at(index, Math.max(0.08, Math.min(1, theme.weight)))
          return (
            <circle key={`dot-${theme.id}-${index}`} cx={x} cy={y} r={2.7} fill="currentColor">
              <title>{`${theme.label} · ${Math.round(theme.weight * 100)}%`}</title>
            </circle>
          )
        })}
        {points.map((theme, index) => {
          const [x, y] = at(index, 1.13)
          const cos = Math.cos(angle(index))
          const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
          return (
            <text
              key={`label-${theme.id}-${index}`}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fill="currentColor"
              className="text-[9.5px] text-muted-foreground"
            >
              <title>{theme.label}</title>
              {shortLabel(theme.label)}
            </text>
          )
        })}
      </g>
    </svg>
  )
}
