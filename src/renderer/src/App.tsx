import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { I18nProvider } from './i18n'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyTheme, useAppStore } from './store/appStore'
import { AppShell } from './components/layout/AppShell'

export function App() {
  const initialized = useAppStore((state) => state.initialized)
  const settings = useAppStore((state) => state.settings)
  const init = useAppStore((state) => state.init)
  const handleEvent = useAppStore((state) => state.handleEvent)

  useEffect(() => {
    void init().catch((error) => {
      console.error(error)
    })
  }, [init])

  useEffect(() => {
    return window.api.app.onEvent(handleEvent)
  }, [handleEvent])

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.appearance.theme)
    if (settings.appearance.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (): void => applyTheme('system')
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [settings?.appearance.theme, settings])

  if (!initialized || !settings) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-lg">
            Lx
          </div>
          <div className="text-xs text-muted-foreground">LiteratureX</div>
        </div>
      </div>
    )
  }

  return (
    <I18nProvider language={settings.appearance.language}>
      <TooltipProvider delayDuration={250} skipDelayDuration={100}>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--popover)',
              color: 'var(--popover-foreground)',
              border: '1px solid var(--border)',
              fontSize: '12.5px'
            }
          }}
        />
      </TooltipProvider>
    </I18nProvider>
  )
}
