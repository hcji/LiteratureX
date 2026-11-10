import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, Check, Globe, Link2, Plus, Radio, Search } from 'lucide-react'
import type { FeedCandidate, JournalCandidate, SubscriptionGroup } from '@shared/types'
import { useT } from '../i18n'
import { cn, errorMessage, formatDate } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, Input } from './ui/input'
import { Badge } from './ui/badge'
import { Spinner } from './ui/feedback'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export function AddJournalDialog({
  open,
  onOpenChange,
  groups,
  onCreated,
  onGroupsChanged
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: SubscriptionGroup[]
  onCreated: () => void
  onGroupsChanged: () => void
}) {
  const { t, language } = useT()
  const [step, setStep] = useState(1)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [journals, setJournals] = useState<JournalCandidate[]>([])
  const [selectedJournal, setSelectedJournal] = useState<JournalCandidate | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [feeds, setFeeds] = useState<FeedCandidate[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [selectedFeed, setSelectedFeed] = useState<FeedCandidate | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [validating, setValidating] = useState(false)
  const [manualFeed, setManualFeed] = useState<FeedCandidate | null>(null)
  const [manualJournalTitle, setManualJournalTitle] = useState('')
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState<string>('none')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [syncNow, setSyncNow] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [localGroups, setLocalGroups] = useState<SubscriptionGroup[]>(groups)

  useEffect(() => {
    setLocalGroups(groups)
  }, [groups])

  useEffect(() => {
    if (!open) {
      setStep(1)
      setQuery('')
      setJournals([])
      setSelectedJournal(null)
      setFeeds([])
      setNotes([])
      setSelectedFeed(null)
      setManualUrl('')
      setManualFeed(null)
      setManualJournalTitle('')
      setName('')
      setGroupId('none')
      setIntervalMinutes('60')
      setSyncNow(true)
      setNewGroupName('')
      setSearching(false)
      setDiscovering(false)
    }
  }, [open])

  const activeFeed = manualFeed ?? selectedFeed

  const search = async (): Promise<void> => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const results = await window.api.journals.search(query.trim())
      setJournals(results)
      if (!results.length) toast.warning(t('discover.noJournalResults'))
    } catch (error) {
      toast.error(t('discover.journalSearchFailed', { error: errorMessage(error) }))
    } finally {
      setSearching(false)
    }
  }

  const chooseJournal = async (journal: JournalCandidate): Promise<void> => {
    setSelectedJournal(journal)
    setStep(2)
    setDiscovering(true)
    setFeeds([])
    setSelectedFeed(null)
    setNotes([])
    setManualFeed(null)
    try {
      const result = await window.api.journals.discoverFeeds(journal)
      setFeeds(result.candidates)
      setNotes(result.notes)
      setSelectedFeed(result.candidates[0] ?? null)
    } catch (error) {
      setNotes([t('discover.feedDiscoveryFailed', { error: errorMessage(error) })])
    } finally {
      setDiscovering(false)
    }
  }

  const validateManual = async (): Promise<void> => {
    const value = manualUrl.trim()
    if (!/^https?:\/\//i.test(value) && !/^crossref:\/\/journal\/\d{4}-\d{3}[\dXx]$/i.test(value)) {
      toast.error(t('discover.invalidUrl'))
      return
    }
    setValidating(true)
    try {
      const candidate = await window.api.journals.validateFeed(value)
      if (candidate.error || candidate.itemCount === 0) {
        setManualFeed(null)
        toast.error(t('discover.invalidFeed', { error: candidate.error ?? t('common.unknownError') }))
      } else {
        setManualFeed(candidate)
        setSelectedFeed(null)
        toast.success(t('discover.validFeed', { n: candidate.itemCount }))
      }
    } catch (error) {
      setManualFeed(null)
      toast.error(t('discover.invalidFeed', { error: errorMessage(error) }))
    } finally {
      setValidating(false)
    }
  }

  const createGroup = async (): Promise<void> => {
    if (!newGroupName.trim()) return
    try {
      const group = await window.api.groups.create(newGroupName.trim())
      setLocalGroups((current) => [...current, group])
      setGroupId(group.id)
      setNewGroupName('')
      onGroupsChanged()
    } catch (error) {
      toast.error(t('discover.groupCreateFailed', { error: errorMessage(error) }))
    }
  }

  const submit = async (): Promise<void> => {
    if (!activeFeed) {
      toast.error(t('discover.feedRequired'))
      return
    }
    setSubmitting(true)
    try {
      const journalTitle =
        selectedJournal?.title || manualJournalTitle.trim() || activeFeed.feedTitle || t('common.unknown')
      await window.api.subscriptions.add({
        feedUrl: activeFeed.url,
        feedTitle: activeFeed.feedTitle,
        journalTitle,
        issn: selectedJournal?.issn ?? null,
        eissn: selectedJournal?.eissn ?? null,
        publisher: selectedJournal?.publisher ?? null,
        homepageUrl: selectedJournal?.homepageUrl ?? null,
        name: name.trim() || undefined,
        groupId: groupId === 'none' ? null : groupId,
        intervalMinutes: Math.max(5, Number(intervalMinutes) || 60),
        discoveredBy: activeFeed.source,
        syncNow
      })
      toast.success(t('discover.addedSubscription', { name: name.trim() || journalTitle }))
      onOpenChange(false)
      onCreated()
    } catch (error) {
      toast.error(t('discover.subscribeFailed', { error: errorMessage(error) }))
    } finally {
      setSubmitting(false)
    }
  }

  const feedCard = (candidate: FeedCandidate, selected: boolean, onClick: () => void): React.ReactNode => (
    <button
      key={candidate.url}
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition',
        selected ? 'border-primary/60 bg-primary/[0.04] ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold">
            <Radio size={12} className="shrink-0 text-primary" />
            <span className="truncate">{candidate.feedTitle || candidate.url}</span>
            {selected ? <Check size={12} className="text-primary" /> : null}
          </div>
          <div className="mt-0.5 break-all font-mono text-[9.5px] text-muted-foreground">{candidate.url}</div>
        </div>
        <Badge variant="secondary">{candidate.type.toUpperCase()}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span>{t('discover.items', { n: candidate.itemCount })}</span>
        {candidate.latestDate ? <span>· {t('discover.latest', { date: formatDate(candidate.latestDate, language) })}</span> : null}
        <span className="rounded bg-muted px-1.5 py-0.5">{candidate.source}</span>
      </div>
      {candidate.sampleTitles.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {candidate.sampleTitles.map((title) => (
            <li key={title} className="line-clamp-1 text-[10.5px] text-foreground/70">
              · {title}
            </li>
          ))}
        </ul>
      ) : null}
    </button>
  )

  const selectedTitle = useMemo(() => {
    if (selectedJournal) return selectedJournal.title
    if (manualJournalTitle.trim()) return manualJournalTitle.trim()
    return activeFeed?.feedTitle ?? ''
  }, [selectedJournal, manualJournalTitle, activeFeed])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle>{t('discover.addJournalTitle')}</DialogTitle>
          <DialogDescription>{t('discover.addJournalDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border/60 px-5 py-2 text-[10.5px]">
          {[1, 2, 3].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold',
                  step >= item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                {item}
              </span>
              <span className={step === item ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {item === 1 ? t('discover.stepSearch') : item === 2 ? t('discover.stepFeeds') : t('discover.stepConfirm')}
              </span>
              {item < 3 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
            </div>
          ))}
        </div>

        <DialogBody className="min-h-[220px]">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void search()
                  }}
                  placeholder={t('discover.searchJournalPlaceholder')}
                />
                <Button onClick={() => void search()} disabled={searching || !query.trim()}>
                  {searching ? <Spinner size={13} /> : <Search size={13} />}
                  {t('discover.searchJournal')}
                </Button>
              </div>

              {journals.length ? (
                <div className="space-y-1.5">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('discover.journalResults')}
                  </div>
                  {journals.map((journal) => (
                    <button
                      key={`${journal.issn}-${journal.title}`}
                      type="button"
                      onClick={() => void chooseJournal(journal)}
                      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-muted/30"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Globe size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-semibold">{journal.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          {journal.issn ? <span className="font-mono">ISSN {journal.issn}</span> : null}
                          {journal.eissn ? <span className="font-mono">eISSN {journal.eissn}</span> : null}
                          {journal.publisher ? <span>· {journal.publisher}</span> : null}
                          <Badge variant="outline">{journal.source}</Badge>
                        </div>
                      </div>
                      <ArrowRight size={14} className="shrink-0 text-muted-foreground/50 transition group-hover:text-primary" />
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="rounded-lg border border-dashed border-border p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Link2 size={12} /> {t('discover.directRss')}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={manualUrl}
                    onChange={(event) => setManualUrl(event.target.value)}
                    placeholder="https://journal.example.org/rss"
                    className="font-mono text-[11px]"
                  />
                  <Button variant="outline" onClick={() => void validateManual()} disabled={validating || !manualUrl.trim()}>
                    {validating ? <Spinner size={13} /> : <Check size={13} />}
                    {t('discover.validate')}
                  </Button>
                </div>
                {manualFeed ? (
                  <div className="mt-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2 text-[10.5px] text-emerald-700 dark:text-emerald-300">
                    {t('discover.feedValid', { n: manualFeed.itemCount })}
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-2"
                      onClick={() => {
                        setStep(3)
                      }}
                    >
                      {t('common.next')} <ArrowRight size={11} />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold">{selectedJournal?.title}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {[selectedJournal?.issn ? `ISSN ${selectedJournal.issn}` : null, selectedJournal?.publisher]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <Button variant="ghost" size="xs" onClick={() => setStep(1)}>
                  <ArrowLeft size={12} /> {t('discover.backToSearch')}
                </Button>
              </div>

              {discovering ? (
                <div className="flex items-center justify-center gap-2 py-12 text-[11.5px] text-muted-foreground">
                  <Spinner /> {t('discover.discovering')}
                </div>
              ) : (
                <>
                  {notes.length ? (
                    <div className="space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
                      {notes.map((note) => (
                        <p key={note} className="text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                          {note}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('discover.feedCandidates')}
                  </div>
                  <div className="space-y-2">
                    {feeds.map((candidate) => feedCard(candidate, selectedFeed?.url === candidate.url, () => {
                      setSelectedFeed(candidate)
                      setManualFeed(null)
                    }))}
                  </div>
                  {!feeds.length ? (
                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground">
                      {t('discover.noFeedsFound')}
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-dashed border-border p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <Link2 size={12} /> {t('discover.manualUrl')}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={manualUrl}
                        onChange={(event) => setManualUrl(event.target.value)}
                        placeholder="https://journal.example.org/rss"
                        className="font-mono text-[11px]"
                      />
                      <Button variant="outline" onClick={() => void validateManual()} disabled={validating || !manualUrl.trim()}>
                        {validating ? <Spinner size={13} /> : <Check size={13} />}
                        {t('discover.validate')}
                      </Button>
                    </div>
                    {manualFeed ? (
                      <div className="mt-2 text-[10.5px] text-emerald-700 dark:text-emerald-300">
                        {t('discover.validFeed', { n: manualFeed.itemCount })}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/25 p-3">
                <div className="text-[12px] font-semibold">{selectedTitle}</div>
                <div className="mt-0.5 break-all font-mono text-[9.5px] text-muted-foreground">{activeFeed?.url}</div>
                <div className="mt-1 flex gap-1.5">
                  <Badge variant="secondary">{activeFeed?.type.toUpperCase()}</Badge>
                  <Badge variant="outline">{activeFeed?.source}</Badge>
                  <Badge variant="outline">{t('discover.items', { n: activeFeed?.itemCount ?? 0 })}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('discover.subscriptionName')}>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={selectedTitle} />
                </Field>
                <Field label={t('discover.interval')}>
                  <Input
                    value={intervalMinutes}
                    inputMode="numeric"
                    onChange={(event) => setIntervalMinutes(event.target.value)}
                  />
                </Field>
                <Field label={t('discover.group')}>
                  <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('discover.noGroup')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('discover.noGroup')}</SelectItem>
                      {localGroups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t('discover.newGroup')}>
                  <div className="flex gap-1">
                    <Input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} />
                    <Button variant="outline" size="icon" onClick={() => void createGroup()} disabled={!newGroupName.trim()}>
                      <Plus size={14} />
                    </Button>
                  </div>
                </Field>
              </div>

              <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <input type="checkbox" checked={syncNow} onChange={(event) => setSyncNow(event.target.checked)} />
                {t('discover.syncNow')}
              </label>

              {!selectedJournal ? (
                <Field label={t('discover.manualJournalTitle')}>
                  <Input value={manualJournalTitle} onChange={(event) => setManualJournalTitle(event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {step > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={13} /> {t('common.back')}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button size="sm" disabled={!activeFeed} onClick={() => setStep(3)}>
              {t('common.next')} <ArrowRight size={13} />
            </Button>
          ) : null}
          {step === 3 ? (
            <Button size="sm" onClick={() => void submit()} disabled={submitting || !activeFeed}>
              {submitting ? <Spinner size={13} /> : <Check size={13} />}
              {submitting ? t('discover.adding') : t('discover.addSubscription')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
