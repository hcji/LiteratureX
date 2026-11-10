import { CheckCircle2, AlertCircle } from 'lucide-react'
import type { OperationKind } from '@shared/types'
import { useT, type TranslationKey } from '../../i18n'
import { useAppStore, type OperationState } from '../../store/appStore'
import { cn } from '../../lib/utils'

const LABEL_KEYS: Record<OperationKind, TranslationKey> = {
  'pdf-import': 'operations.pdfImport',
  classification: 'operations.classification',
  taxonomy: 'operations.taxonomy',
  sync: 'operations.sync',
  assistant: 'operations.assistant',
  download: 'operations.download',
  backup: 'operations.backup',
  restore: 'operations.restore',
  import: 'operations.import'
}

export function operationPercent(operation: OperationState): number | undefined {
  if (operation.percent != null) return Math.max(0, Math.min(1, operation.percent))
  if (operation.current != null && operation.total) return Math.max(0, Math.min(1, operation.current / operation.total))
  return undefined
}

function sortedOperations(operations: Record<string, OperationState>): OperationState[] {
  return Object.values(operations).sort((a, b) => {
    if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1
    return b.startedAt - a.startedAt
  })
}

export function OperationTopBar() {
  const operations = useAppStore((state) => state.operations)
  const running = sortedOperations(operations).filter((operation) => operation.status === 'running')
  if (!running.length) return null
  const percents = running.map(operationPercent)
  const overall = percents.every((value): value is number => value != null) ? Math.min(...percents) : undefined
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[2px] overflow-hidden bg-primary/10">
      {overall != null ? (
        <div
          className="h-full rounded-r-full bg-primary transition-all duration-300"
          style={{ width: `${Math.max(2, overall * 100)}%` }}
        />
      ) : (
        <div className="h-full w-1/3 animate-progress rounded-full bg-primary" />
      )}
    </div>
  )
}

export function OperationList() {
  const { t } = useT()
  const operations = useAppStore((state) => state.operations)
  const list = sortedOperations(operations).slice(0, 3)
  if (!list.length) return null
  return (
    <div className="space-y-2.5 border-t border-white/[0.07] px-3 py-2.5">
      {list.map((operation) => {
        const percent = operationPercent(operation)
        const running = operation.status === 'running'
        const label = t(LABEL_KEYS[operation.kind])
        const count = operation.total ? `${operation.current ?? 0}/${operation.total}` : null
        return (
          <div key={operation.id} title={operation.error ?? operation.detail ?? label}>
            <div className="flex items-center gap-1.5 text-[10.5px]">
              {running ? (
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-teal-300" />
              ) : operation.status === 'error' ? (
                <AlertCircle size={11} className="shrink-0 text-red-400" />
              ) : (
                <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
              )}
              <span className="min-w-0 flex-1 truncate text-sidebar-foreground/80">
                {label}
                {count ? <span className="ml-1 tabular-nums text-sidebar-foreground/45">{count}</span> : null}
              </span>
              <span
                className={cn(
                  'shrink-0 tabular-nums',
                  operation.status === 'error' ? 'text-red-400' : 'text-sidebar-foreground/45'
                )}
              >
                {running
                  ? percent != null
                    ? `${Math.round(percent * 100)}%`
                    : t('operations.running')
                  : operation.status === 'error'
                    ? t('operations.failed')
                    : t('operations.done')}
              </span>
            </div>
            {running ? (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                {percent != null ? (
                  <div
                    className="h-full rounded-full bg-teal-400 transition-all duration-300"
                    style={{ width: `${Math.max(2, percent * 100)}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-progress rounded-full bg-teal-400" />
                )}
              </div>
            ) : operation.status === 'error' && operation.error ? (
              <div className="mt-0.5 truncate text-[9.5px] text-red-300/80">{operation.error}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
