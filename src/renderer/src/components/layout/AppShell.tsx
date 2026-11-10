import { useEffect } from 'react'
import { Compass, FolderTree, Languages, LayoutDashboard, Library, Moon, Settings as SettingsIcon, Sparkles, Sun } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore, type Route } from '../../store/appStore'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DashboardPage } from '../../pages/DashboardPage'
import { DiscoverPage } from '../../pages/DiscoverPage'
import { LibraryPage } from '../../pages/LibraryPage'
import { CollectionsPage } from '../../pages/CollectionsPage'
import { AssistantPage } from '../../pages/AssistantPage'
import { SettingsPage } from '../../pages/SettingsPage'
import { OperationList, OperationTopBar } from './OperationProgress'

const navItems: Array<{ route: Route; icon: typeof LayoutDashboard; labelKey: Parameters<ReturnType<typeof useT>['t']>[0] }> = [
  { route: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { route: 'discover', icon: Compass, labelKey: 'nav.discover' },
  { route: 'library', icon: Library, labelKey: 'nav.library' },
  { route: 'collections', icon: FolderTree, labelKey: 'nav.collections' },
  { route: 'assistant', icon: Sparkles, labelKey: 'nav.assistant' },
  { route: 'settings', icon: SettingsIcon, labelKey: 'nav.settings' }
]

export function AppShell() {
  const { t, language } = useT()
  const route = useAppStore((state) => state.route)
  const setRoute = useAppStore((state) => state.setRoute)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const theme = settings?.appearance.theme ?? 'system'
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const aiReady = Boolean(settings?.ai.apiKeySet && settings.ai.model)

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (document.querySelector('[role="dialog"]') || document.querySelector('[data-pdf-reader]')) return
      const index = Number(event.key)
      if (index >= 1 && index <= navItems.length) {
        event.preventDefault()
        setRoute(navItems[index - 1].route)
        return
      }
      if (event.key === ',') {
        event.preventDefault()
        setRoute('settings')
        return
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const focusSearch = (): boolean => {
          const input = document.querySelector<HTMLInputElement>('[data-page-search]')
          if (!input) return false
          input.focus()
          input.select()
          return true
        }
        if (!focusSearch()) {
          setRoute('library')
          setTimeout(focusSearch, 120)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setRoute])

  const cycleTheme = (): void => {
    void updateSettings({ appearance: { theme: isDark ? 'light' : 'dark' } })
  }

  const toggleLanguage = (): void => {
    void updateSettings({ appearance: { language: language === 'zh' ? 'en' : 'zh' } })
  }

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside className="flex w-[212px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2.5 px-4 pb-5 pt-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 text-[13px] font-bold text-white shadow-lg shadow-emerald-900/30">
            Lx
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-wide">LiteratureX</div>
            <div className="text-[10px] text-sidebar-foreground/50">{t('settings.aboutDesc')}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2.5">
          {navItems.map((item, index) => {
            const Icon = item.icon
            const active = route === item.route
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => setRoute(item.route)}
                title={`Ctrl+${index + 1}`}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-left text-[13px] transition',
                  active
                    ? 'bg-white/[0.09] text-white'
                    : 'text-sidebar-foreground/65 hover:bg-white/[0.05] hover:text-sidebar-foreground'
                )}
              >
                <Icon size={16} className={cn('shrink-0', active ? 'text-teal-300' : 'opacity-75')} strokeWidth={1.9} />
                <span className="flex-1 truncate">{t(item.labelKey)}</span>
              </button>
            )
          })}
        </nav>

        <OperationList />

        <div className="space-y-2 border-t border-white/[0.07] px-3 py-3">
          <button
            type="button"
            onClick={() => setRoute('settings')}
            title={aiReady ? t('dashboard.aiConfigured') : t('dashboard.aiNotConfigured')}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-sidebar-foreground/55 transition hover:bg-white/[0.06] hover:text-sidebar-foreground"
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', aiReady ? 'bg-emerald-400' : 'bg-amber-400')} />
            <span className="truncate">{aiReady ? t('dashboard.aiConfigured') : t('dashboard.localMode')}</span>
          </button>
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleLanguage}
                  className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-sidebar-foreground/60 transition hover:bg-white/[0.06] hover:text-sidebar-foreground"
                >
                  <Languages size={14} />
                  {language === 'zh' ? '中 / EN' : 'EN / 中'}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('common.language')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={cycleTheme}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/60 transition hover:bg-white/[0.06] hover:text-sidebar-foreground"
                >
                  {isDark ? <Moon size={14} /> : <Sun size={14} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('common.theme')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <OperationTopBar />
        {route === 'dashboard' ? <DashboardPage /> : null}
        {route === 'discover' ? <DiscoverPage /> : null}
        {route === 'library' ? <LibraryPage /> : null}
        {route === 'collections' ? <CollectionsPage /> : null}
        {route === 'assistant' ? <AssistantPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </main>
    </div>
  )
}
