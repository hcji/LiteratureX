import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Archive,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  KeyRound,
  Palette,
  Plug,
  RefreshCw,
  Rss,
  Save,
  ShieldCheck,
  Trash2,
  Upload
} from 'lucide-react'
import type { AppInfo, AppSettings, BackupInfo, PluginStatus, SyncHistoryEntry } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { errorMessage, formatBytes, formatDateTime } from '../lib/utils'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/button'
import { Input, Field, Textarea } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Spinner, Progress } from '../components/ui/feedback'
import { operationPercent } from '../components/layout/OperationProgress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/primitives'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '../components/ui/alert-dialog'

type Section = 'ai' | 'rss' | 'storage' | 'plugins' | 'data' | 'appearance' | 'about'

const sectionDefs: Array<{ value: Section; labelKey: Parameters<ReturnType<typeof useT>['t']>[0]; icon: typeof Bot }> = [
  { value: 'ai', labelKey: 'settings.aiTitle', icon: Bot },
  { value: 'rss', labelKey: 'settings.rssTitle', icon: Rss },
  { value: 'storage', labelKey: 'settings.storageTitle', icon: HardDrive },
  { value: 'plugins', labelKey: 'settings.pluginsTitle', icon: Plug },
  { value: 'data', labelKey: 'settings.dataTitle', icon: Database },
  { value: 'appearance', labelKey: 'settings.appearanceTitle', icon: Palette },
  { value: 'about', labelKey: 'settings.aboutTitle', icon: Info }
]

export function SettingsPage() {
  const { t } = useT()
  const settings = useAppStore((state) => state.settings)
  const info = useAppStore((state) => state.info)
  const refreshInfo = useAppStore((state) => state.refreshInfo)
  const [section, setSection] = useState<Section>('ai')
  const [history, setHistory] = useState<SyncHistoryEntry[]>([])
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (section !== 'rss') return
    setLoadingHistory(true)
    void window.api.subscriptions
      .history(40)
      .then(setHistory)
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => setLoadingHistory(false))
  }, [section])

  useEffect(() => {
    if (section !== 'data') return
    void window.api.io
      .listBackups()
      .then(setBackups)
      .catch((error) => toast.error(errorMessage(error)))
  }, [section])

  useEffect(() => {
    void refreshInfo()
  }, [refreshInfo])

  if (!settings) return null

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[200px] shrink-0 border-r border-border/70 bg-card/25 p-2">
          <div className="space-y-0.5">
            {sectionDefs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSection(item.value)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition ${
                    section === item.value
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-foreground/70 hover:bg-muted/60'
                  }`}
                >
                  <Icon size={14} className="opacity-70" />
                  {t(item.labelKey)}
                </button>
              )
            })}
          </div>
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-3xl">
            {section === 'ai' ? <AiSection settings={settings} /> : null}
            {section === 'rss' ? (
              <RssSection settings={settings} history={history} loadingHistory={loadingHistory} reloadHistory={async () => {
                const list = await window.api.subscriptions.history(40)
                setHistory(list)
              }} />
            ) : null}
            {section === 'storage' ? <StorageSection settings={settings} /> : null}
            {section === 'plugins' ? <PluginSection /> : null}
            {section === 'data' ? (
              <>
                <DataSection info={info} backups={backups} reloadBackups={async () => setBackups(await window.api.io.listBackups())} />
                <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/[0.03] p-4">
                  <h3 className="text-[12.5px] font-semibold text-destructive">{t('settings.dangerZone')}</h3>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">{t('settings.restoreWarning')}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setRestoreOpen(true)}
                  >
                    <Archive size={13} /> {t('settings.restoreBackup')}
                  </Button>
                </div>
              </>
            ) : null}
            {section === 'appearance' ? <AppearanceSection settings={settings} /> : null}
            {section === 'about' ? <AboutSection info={info} settings={settings} /> : null}
          </div>
        </div>
      </div>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('settings.restoreBackup')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.restoreWarning')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRestoreOpen(false)
                void window.api.io
                  .restore()
                  .then((result) => {
                    if (result) toast.info(t('settings.restoreStarted'))
                  })
                  .catch((error) => toast.error(errorMessage(error)))
              }}
            >
              {t('settings.restoreConfirmButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SectionCard({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/80 bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function AiSection({ settings }: { settings: AppSettings }) {
  const { t } = useT()
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form, setForm] = useState({
    provider: settings.ai.provider,
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    apiKey: '',
    temperature: String(settings.ai.temperature),
    maxTokens: String(settings.ai.maxTokens),
    timeoutMs: String(settings.ai.timeoutMs),
    high: String(settings.ai.thresholds.high),
    medium: String(settings.ai.thresholds.medium),
    autoClassify: settings.ai.autoClassify,
    sendFullText: settings.ai.sendFullText
  })

  useEffect(() => {
    setForm((current) => ({
      ...current,
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKey: '',
      temperature: String(settings.ai.temperature),
      maxTokens: String(settings.ai.maxTokens),
      timeoutMs: String(settings.ai.timeoutMs),
      high: String(settings.ai.thresholds.high),
      medium: String(settings.ai.thresholds.medium),
      autoClassify: settings.ai.autoClassify,
      sendFullText: settings.ai.sendFullText
    }))
  }, [settings])

  const update = (key: keyof typeof form, value: string | boolean): void => setForm((current) => ({ ...current, [key]: value }))

  const save = async (): Promise<AppSettings | null> => {
    setSaving(true)
    try {
      const next = await updateSettings({
        ai: {
          provider: form.provider,
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim(),
          temperature: Number(form.temperature) || 0,
          maxTokens: Number(form.maxTokens) || 1600,
          timeoutMs: Number(form.timeoutMs) || 60000,
          autoClassify: form.autoClassify,
          sendFullText: form.sendFullText,
          thresholds: { high: Number(form.high) || 0.78, medium: Number(form.medium) || 0.52 },
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
        }
      })
      setForm((current) => ({ ...current, apiKey: '' }))
      toast.success(t('settings.settingsSaved'))
      return next
    } catch (error) {
      toast.error(t('settings.saveFailed', { error: errorMessage(error) }))
      return null
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      const saved = await save()
      if (!saved) return
      const message = await window.api.settings.testAi()
      toast.success(t('settings.connectionOk', { message }))
    } catch (error) {
      toast.error(t('settings.connectionFailed', { error: errorMessage(error) }))
    } finally {
      setTesting(false)
    }
  }

  const clearKey = async (): Promise<void> => {
    try {
      await updateSettings({ ai: { apiKey: null } })
      toast.success(t('settings.keyCleared'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('settings.aiTitle')}
        description={t('settings.aiDesc')}
        action={<Badge variant={settings.ai.apiKeySet ? 'success' : 'warning'}>{settings.ai.apiKeySet ? t('settings.aiConfigured') : t('settings.aiNotConfigured')}</Badge>}
      >
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('settings.providerMode')}>
              <Select value={form.provider} onValueChange={(value) => update('provider', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('settings.modeAuto')}</SelectItem>
                  <SelectItem value="openai">{t('settings.modeOpenAI')}</SelectItem>
                  <SelectItem value="heuristic">{t('settings.modeHeuristic')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('settings.model')}>
              <Input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="gpt-4o-mini / deepseek-chat / qwen-plus" />
            </Field>
            <Field label={t('settings.baseUrl')}>
              <Input value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" />
            </Field>
            <Field
              label={t('settings.apiKey')}
              hint={settings.ai.apiKeySet ? t('settings.apiKeyConfigured') : t('settings.apiKeyHint')}
            >
              <div className="flex gap-1">
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => update('apiKey', event.target.value)}
                  placeholder={t('settings.apiKeyPlaceholder')}
                  autoComplete="off"
                />
                {settings.ai.apiKeySet ? (
                  <Button variant="outline" size="sm" onClick={() => void clearKey()}>
                    {t('common.clear')}
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
          <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
            {t('settings.aiSectionHint')}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('settings.temperature')}>
              <Input value={form.temperature} inputMode="decimal" onChange={(event) => update('temperature', event.target.value)} />
            </Field>
            <Field label={t('settings.maxTokens')}>
              <Input value={form.maxTokens} inputMode="numeric" onChange={(event) => update('maxTokens', event.target.value)} />
            </Field>
            <Field label={t('settings.timeout')}>
              <Input value={form.timeoutMs} inputMode="numeric" onChange={(event) => update('timeoutMs', event.target.value)} />
            </Field>
            <Field label={t('settings.thresholdHigh')}>
              <Input value={form.high} inputMode="decimal" onChange={(event) => update('high', event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('settings.thresholdMedium')} hint={t('settings.thresholdHint')}>
              <Input value={form.medium} inputMode="decimal" onChange={(event) => update('medium', event.target.value)} />
            </Field>
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <label className="flex items-center justify-between gap-2 text-[11.5px]">
                {t('settings.autoClassify')}
                <Switch checked={form.autoClassify} onCheckedChange={(value) => update('autoClassify', value)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-[11.5px]">
                {t('settings.sendFullText')}
                <Switch checked={form.sendFullText} onCheckedChange={(value) => update('sendFullText', value)} />
              </label>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">{t('settings.sendFullTextHint')}</p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing}>
              {testing ? <Spinner size={13} /> : <RefreshCw size={13} />}
              {testing ? t('settings.testing') : t('settings.testConnection')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={13} /> : <Save size={13} />}
              {t('settings.saveSettings')}
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

function RssSection({
  settings,
  history,
  loadingHistory,
  reloadHistory
}: {
  settings: AppSettings
  history: SyncHistoryEntry[]
  loadingHistory: boolean
  reloadHistory: () => Promise<void>
}) {
  const { t, language } = useT()
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    autoSync: settings.rss.autoSync,
    defaultIntervalMinutes: String(settings.rss.defaultIntervalMinutes),
    itemsPerSync: String(settings.rss.itemsPerSync),
    contactEmail: settings.rss.contactEmail
  })

  useEffect(() => {
    setForm({
      autoSync: settings.rss.autoSync,
      defaultIntervalMinutes: String(settings.rss.defaultIntervalMinutes),
      itemsPerSync: String(settings.rss.itemsPerSync),
      contactEmail: settings.rss.contactEmail
    })
  }, [settings])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await updateSettings({
        rss: {
          autoSync: form.autoSync,
          defaultIntervalMinutes: Number(form.defaultIntervalMinutes) || 60,
          itemsPerSync: Number(form.itemsPerSync) || 80,
          contactEmail: form.contactEmail.trim()
        }
      })
      toast.success(t('settings.settingsSaved'))
    } catch (error) {
      toast.error(t('settings.saveFailed', { error: errorMessage(error) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title={t('settings.rssTitle')} description={t('settings.rssDesc')}>
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-[11.5px]">
              {t('settings.autoSync')}
              <Switch checked={form.autoSync} onCheckedChange={(value) => setForm((c) => ({ ...c, autoSync: value }))} />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t('settings.defaultInterval')} hint={t('settings.intervalHint')}>
              <Input
                value={form.defaultIntervalMinutes}
                inputMode="numeric"
                onChange={(event) => setForm((c) => ({ ...c, defaultIntervalMinutes: event.target.value }))}
              />
            </Field>
            <Field label={t('settings.itemsPerSync')}>
              <Input value={form.itemsPerSync} inputMode="numeric" onChange={(event) => setForm((c) => ({ ...c, itemsPerSync: event.target.value }))} />
            </Field>
            <Field label={t('settings.contactEmail')} hint={t('settings.contactEmailHint')}>
              <Input
                value={form.contactEmail}
                onChange={(event) => setForm((c) => ({ ...c, contactEmail: event.target.value }))}
                placeholder="you@example.org"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={13} /> : <Save size={13} />}
              {t('settings.saveSettings')}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t('settings.syncHistory')}
        action={
          <Button variant="outline" size="xs" onClick={() => void reloadHistory()}>
            <RefreshCw size={11} /> {t('common.refresh')}
          </Button>
        }
      >
        {loadingHistory ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : history.length ? (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-[10.5px]">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Feed</th>
                  <th className="px-2 py-1.5 font-medium">{t('common.status')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('common.date')}</th>
                  <th className="px-2 py-1.5 font-medium text-right">Found</th>
                  <th className="px-2 py-1.5 font-medium text-right">New</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} className="border-t border-border/50">
                    <td className="max-w-[220px] truncate px-2 py-1.5">{entry.feedTitle ?? entry.feedId}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant={entry.status === 'success' ? 'success' : entry.status === 'error' ? 'danger' : 'secondary'}>
                        {entry.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{formatDateTime(entry.startedAt, language)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{entry.itemsFound}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{entry.itemsNew}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-[11px] text-muted-foreground">{t('settings.noSyncHistory')}</div>
        )}
      </SectionCard>
    </div>
  )
}

function StorageSection({ settings }: { settings: AppSettings }) {
  const { t } = useT()
  const updateSettings = useAppStore((state) => state.updateSettings)
  const refreshSettings = useAppStore((state) => state.refreshSettings)
  const [mode, setMode] = useState(settings.storage.mode)
  const [dir, setDir] = useState(settings.storage.managedDir)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMode(settings.storage.mode)
    setDir(settings.storage.managedDir)
  }, [settings])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await updateSettings({ storage: { mode, managedDir: dir } })
      toast.success(t('settings.settingsSaved'))
    } catch (error) {
      toast.error(t('settings.saveFailed', { error: errorMessage(error) }))
    } finally {
      setSaving(false)
    }
  }

  const choose = async (): Promise<void> => {
    try {
      const next = await window.api.settings.chooseStorageDir()
      if (next) {
        setDir(next.storage.managedDir)
        await refreshSettings()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <SectionCard title={t('settings.storageTitle')} description={t('settings.storageDesc')}>
      <div className="space-y-3">
        <Field label={t('settings.storageMode')}>
          <Select value={mode} onValueChange={(value) => setMode(value as 'managed' | 'linked')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="managed">{t('settings.managed')}</SelectItem>
              <SelectItem value="linked">{t('settings.linked')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('settings.managedDir')}>
          <div className="flex gap-2">
            <Input value={dir} onChange={(event) => setDir(event.target.value)} className="font-mono text-[10.5px]" />
            <Button variant="outline" size="sm" onClick={() => void choose()}>
              <FolderOpen size={13} /> {t('settings.chooseFolder')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void window.api.app.openPath(dir)}>
              {t('settings.openFolder')}
            </Button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={13} /> : <Save size={13} />}
            {t('settings.saveSettings')}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

function PluginSection() {
  const { t } = useT()
  const [status, setStatus] = useState<PluginStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'wps-install' | 'wps-uninstall' | 'word-install' | null>(null)

  const load = async (): Promise<void> => {
    try {
      setStatus(await window.api.plugins.status())
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const run = async (kind: 'wps-install' | 'wps-uninstall' | 'word-install'): Promise<void> => {
    setConfirm(null)
    setBusy(kind)
    try {
      if (kind === 'wps-install') {
        const result = await window.api.plugins.installWps()
        toast.success(t('settings.wpsInstallDone'))
        void result
      } else if (kind === 'wps-uninstall') {
        await window.api.plugins.uninstallWps()
        toast.success(t('settings.wpsUninstalled'))
      } else {
        const result = await window.api.plugins.setupWord()
        if (result.trusted) toast.success(t('settings.wordSetupDone'))
        else toast.error(t('settings.wordTrustFailed', { error: result.trustError ?? '' }))
      }
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const openFolder = async (kind: 'wps' | 'word'): Promise<void> => {
    try {
      await window.api.plugins.openFolder(kind)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const openGuide = async (): Promise<void> => {
    try {
      await window.api.plugins.openGuide()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('settings.pluginsTitle')}
        description={t('settings.pluginsDesc')}
        action={
          <Button variant="outline" size="xs" onClick={() => void load()}>
            <RefreshCw size={11} /> {t('common.refresh')}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${status?.httpRunning ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {t('settings.pluginService')}: {status?.httpRunning ? t('settings.pluginRunning') : t('settings.pluginStopped')}
              </span>
              <span className="text-muted-foreground">
                {t('settings.pluginWpsPort')}: {status?.httpPort ?? '—'}
              </span>
              <span className="text-muted-foreground">
                {t('settings.pluginWordPort')}: {status?.httpsPort ?? '—'}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/75">{t('settings.pluginRequiresRunning')}</p>
            {status?.httpError ? (
              <p className="mt-1 text-[10px] text-destructive">{t('settings.pluginError', { error: status.httpError })}</p>
            ) : null}
            {status?.httpsError ? (
              <p className="mt-1 text-[10px] text-destructive">{t('settings.pluginError', { error: status.httpsError })}</p>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/80 bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                    <Plug size={14} />
                  </span>
                  <div>
                    <div className="text-[12px] font-semibold">{t('settings.wpsPlugin')}</div>
                    <div className="text-[9.5px] text-muted-foreground">WPS Writer · JS 加载项</div>
                  </div>
                </div>
                <Badge variant={status?.wpsInstalled ? 'success' : 'secondary'}>
                  {status?.wpsInstalled ? t('settings.wpsInstalled') : t('settings.wpsNotInstalled')}
                </Badge>
              </div>
              <div className="mt-2 break-all rounded-md bg-muted/40 px-2 py-1 font-mono text-[9px] text-muted-foreground">
                {status?.wpsPath ?? '—'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="xs" onClick={() => setConfirm('wps-install')} disabled={Boolean(busy)}>
                  {busy === 'wps-install' ? <Spinner size={11} /> : <Download size={11} />}
                  {t('settings.installWps')}
                </Button>
                {status?.wpsInstalled ? (
                  <Button variant="outline" size="xs" onClick={() => setConfirm('wps-uninstall')} disabled={Boolean(busy)}>
                    <Trash2 size={11} /> {t('settings.uninstallWps')}
                  </Button>
                ) : null}
                <Button variant="ghost" size="xs" onClick={() => void openFolder('wps')}>
                  <FolderOpen size={11} /> {t('common.open')}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
                    <Plug size={14} />
                  </span>
                  <div>
                    <div className="text-[12px] font-semibold">{t('settings.wordPlugin')}</div>
                    <div className="text-[9.5px] text-muted-foreground">Microsoft Word · Office.js</div>
                  </div>
                </div>
                <Badge variant={status?.wordManifestExists ? 'success' : 'secondary'}>
                  {status?.wordManifestExists ? t('settings.wordReady') : t('settings.wordNotReady')}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge variant={status?.certExists ? 'outline' : 'secondary'}>
                  {status?.certExists ? 'TLS' : 'no TLS'}
                </Badge>
                <Badge variant={status?.wordTrusted ? 'success' : 'warning'}>
                  {status?.wordTrusted ? t('settings.wordTrusted') : t('settings.wordTrustPending')}
                </Badge>
              </div>
              <div className="mt-2 break-all rounded-md bg-muted/40 px-2 py-1 font-mono text-[9px] text-muted-foreground">
                {status?.wordManifestPath ?? '—'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="xs" onClick={() => setConfirm('word-install')} disabled={Boolean(busy)}>
                  {busy === 'word-install' ? <Spinner size={11} /> : <Download size={11} />}
                  {t('settings.installWord')}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => void openFolder('word')}>
                  <FolderOpen size={11} /> {t('common.open')}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-primary/15 bg-primary/[0.035] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-primary">
              <ShieldCheck size={12} /> {t('settings.pluginSecurity')}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t('settings.pluginSecurityText')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Button variant="outline" size="xs" onClick={() => void openGuide()}>
              <Info size={11} /> {t('settings.pluginGuide')}
            </Button>
            <span>{t('settings.pluginGuideHint')}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/70">{t('settings.pluginRestartHint')}</p>
        </div>
      </SectionCard>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirm === 'wps-install'
              ? t('settings.installWps')
              : confirm === 'wps-uninstall'
                ? t('settings.uninstallWps')
                : t('settings.installWord')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm === 'wps-install'
              ? t('settings.wpsInstallConfirm')
              : confirm === 'wps-uninstall'
                ? t('settings.wpsUninstallConfirm')
                : t('settings.wordInstallConfirm')}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(confirm)}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DataSection({
  info,
  backups,
  reloadBackups
}: {
  info: AppInfo | null
  backups: BackupInfo[]
  reloadBackups: () => Promise<void>
}) {
  const { t, language } = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const operations = useAppStore((state) => state.operations)
  const backupOperation = Object.values(operations).find(
    (operation) => operation.kind === 'backup' && operation.status === 'running'
  )
  const backupPercent = backupOperation ? operationPercent(backupOperation) : undefined

  const exportData = async (format: 'bibtex' | 'ris' | 'csv' | 'json'): Promise<void> => {
    setBusy(`export-${format}`)
    try {
      const result = await window.api.io.export(format)
      if (result) toast.success(t('settings.exportDone', { count: result.count, path: result.path }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const importData = async (format: 'bibtex' | 'ris' | 'json'): Promise<void> => {
    setBusy(`import-${format}`)
    try {
      const result = await window.api.io.import(format)
      if (result) {
        toast.success(t('settings.importDone', { imported: result.imported ?? 0, skipped: result.skipped ?? 0 }))
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const createBackup = async (): Promise<void> => {
    setBusy('backup')
    try {
      const result = await window.api.io.backup()
      if (result) {
        toast.success(t('settings.backupDone', { path: result.path }))
        await reloadBackups()
      }
    } catch (error) {
      toast.error(t('settings.backupFailed', { error: errorMessage(error) }))
    } finally {
      setBusy(null)
    }
  }

  const vacuum = async (): Promise<void> => {
    setBusy('vacuum')
    try {
      await window.api.io.vacuum()
      toast.success(t('settings.vacuumDone'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title={t('settings.dataTitle')} description={t('settings.dataDesc')}>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('settings.exportData')}</div>
            <div className="flex flex-wrap gap-2">
              {(['bibtex', 'ris', 'csv', 'json'] as const).map((format) => (
                <Button key={format} variant="outline" size="sm" onClick={() => void exportData(format)} disabled={Boolean(busy)}>
                  {busy === `export-${format}` ? <Spinner size={12} /> : <Download size={13} />}
                  {format.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('settings.importData')}</div>
            <div className="flex flex-wrap gap-2">
              {(['bibtex', 'ris', 'json'] as const).map((format) => (
                <Button key={format} variant="outline" size="sm" onClick={() => void importData(format)} disabled={Boolean(busy)}>
                  {busy === `import-${format}` ? <Spinner size={12} /> : <Upload size={13} />}
                  {format.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
            <Button variant="outline" size="sm" onClick={() => void window.api.app.openDataDir()}>
              <FolderOpen size={13} /> {t('settings.openDataFolder')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void vacuum()} disabled={Boolean(busy)}>
              {busy === 'vacuum' ? <Spinner size={12} /> : <Database size={13} />}
              {t('settings.vacuum')}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t('settings.backupTitle')}
        description={t('settings.backupDesc')}
        action={
          <Button variant="outline" size="xs" onClick={() => void createBackup()} disabled={Boolean(busy)}>
            {busy === 'backup' ? <Spinner size={11} /> : <Archive size={11} />}
            {t('settings.createBackup')}
          </Button>
        }
      >
        {backupOperation ? (
          <div className="mb-2.5 space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
              <span>{t('operations.backup')}</span>
              <span className="tabular-nums">
                {backupOperation.total ? `${backupOperation.current ?? 0}/${backupOperation.total}` : t('operations.processing')}
                {backupPercent != null ? ` · ${Math.round(backupPercent * 100)}%` : ''}
              </span>
            </div>
            <Progress value={backupPercent ?? 0} indeterminate={backupPercent == null} className="h-1" />
          </div>
        ) : null}
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">{t('settings.autoSnapshotNote')}</p>
        <div className="mt-2 space-y-1">
          {backups.length ? (
            backups.slice(0, 8).map((backup) => (
              <div key={backup.path} className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-[10.5px]">
                <Clock size={11} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[9.5px]">{backup.fileName}</span>
                <span className="text-muted-foreground">{formatBytes(backup.size)}</span>
                <span className="text-muted-foreground">{formatDateTime(backup.createdAt, language)}</span>
              </div>
            ))
          ) : (
            <div className="py-3 text-center text-[10.5px] text-muted-foreground">{t('settings.noBackups')}</div>
          )}
        </div>
      </SectionCard>

      {info ? (
        <SectionCard title={t('settings.databasePath')}>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[10.5px]">
            <dt className="text-muted-foreground">{t('settings.databasePath')}</dt>
            <dd className="break-all font-mono text-[9.5px]">{info.dbPath}</dd>
            <dt className="text-muted-foreground">{t('settings.pdfPath')}</dt>
            <dd className="break-all font-mono text-[9.5px]">{info.pdfDir}</dd>
          </dl>
        </SectionCard>
      ) : null}
    </div>
  )
}

function AppearanceSection({ settings }: { settings: AppSettings }) {
  const { t } = useT()
  const updateSettings = useAppStore((state) => state.updateSettings)

  return (
    <SectionCard title={t('settings.appearanceTitle')} description={t('settings.appearanceDesc')}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('common.theme')}>
          <Select
            value={settings.appearance.theme}
            onValueChange={(value) => void updateSettings({ appearance: { theme: value as AppSettings['appearance']['theme'] } })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{t('common.light')}</SelectItem>
              <SelectItem value="dark">{t('common.dark')}</SelectItem>
              <SelectItem value="system">{t('common.system')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('common.language')}>
          <Select
            value={settings.appearance.language}
            onValueChange={(value) => void updateSettings({ appearance: { language: value as AppSettings['appearance']['language'] } })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">{t('common.chinese')}</SelectItem>
              <SelectItem value="en">{t('common.english')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </SectionCard>
  )
}

function AboutSection({ info, settings }: { info: AppInfo | null; settings: AppSettings }) {
  const { t } = useT()
  return (
    <div className="space-y-4">
      <SectionCard title={t('settings.aboutTitle')} description={t('settings.aboutDesc')}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 text-base font-bold text-white shadow-lg">
            Lx
          </div>
          <div>
            <div className="text-[14px] font-semibold">LiteratureX</div>
            <div className="text-[10.5px] text-muted-foreground">
              {t('common.version')} {info?.version ?? '0.1.0'} · {info?.platform ?? ''}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant={info?.fts5 ? 'success' : 'warning'}>{info?.fts5 ? t('settings.fts5Enabled') : t('settings.fts5Missing')}</Badge>
          <Badge variant={settings.ai.apiKeySet && settings.ai.model ? 'success' : 'secondary'}>
            {settings.ai.apiKeySet && settings.ai.model ? t('settings.aiConfigured') : t('settings.aiNotConfigured')}
          </Badge>
        </div>
      </SectionCard>

      <SectionCard title={t('settings.privacy')}>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">{t('settings.privacyText')}</p>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <ShieldCheck size={12} className="text-primary" /> {t('settings.apiKeyHint')}
        </div>
      </SectionCard>

      {info ? (
        <SectionCard title={t('settings.dataTitle')}>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[10.5px]">
            <dt className="text-muted-foreground">{t('settings.databasePath')}</dt>
            <dd className="break-all font-mono text-[9.5px]">{info.dbPath}</dd>
            <dt className="text-muted-foreground">{t('settings.pdfPath')}</dt>
            <dd className="break-all font-mono text-[9.5px]">{info.pdfDir}</dd>
          </dl>
        </SectionCard>
      ) : null}
    </div>
  )
}
