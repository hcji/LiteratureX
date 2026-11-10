import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Article } from '@shared/types'
import { useT } from '../i18n'
import { errorMessage, splitAuthors, splitKeywords } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, Input, Textarea } from './ui/input'

export function MetadataEditDialog({
  article,
  open,
  onOpenChange,
  onSaved
}: {
  article: Article | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useT()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    authors: '',
    journalTitle: '',
    year: '',
    publicationDate: '',
    volume: '',
    issue: '',
    pages: '',
    doi: '',
    url: '',
    publisher: '',
    articleType: '',
    abstract: '',
    keywords: ''
  })

  useEffect(() => {
    if (!open || !article) return
    setForm({
      title: article.title ?? '',
      authors: article.authors.map((author) => author.name).join('; '),
      journalTitle: article.journalTitle ?? '',
      year: article.year ? String(article.year) : '',
      publicationDate: article.publicationDate?.slice(0, 10) ?? '',
      volume: article.volume ?? '',
      issue: article.issue ?? '',
      pages: article.pages ?? '',
      doi: article.doi ?? '',
      url: article.url ?? '',
      publisher: article.publisher ?? '',
      articleType: article.articleType ?? '',
      abstract: article.abstract ?? '',
      keywords: article.keywords.join(', ')
    })
  }, [open, article])

  const update = (key: keyof typeof form, value: string): void => setForm((current) => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    if (!article) return
    if (!form.title.trim()) {
      toast.error(t('common.requiredField'))
      return
    }
    setSaving(true)
    try {
      await window.api.articles.update(article.id, {
        title: form.title.trim(),
        authors: splitAuthors(form.authors),
        journalTitle: form.journalTitle.trim() || null,
        year: form.year.trim() && Number.isFinite(Number(form.year)) ? Number(form.year) : null,
        publicationDate: form.publicationDate || null,
        volume: form.volume.trim() || null,
        issue: form.issue.trim() || null,
        pages: form.pages.trim() || null,
        doi: form.doi.trim() || null,
        url: form.url.trim() || null,
        publisher: form.publisher.trim() || null,
        articleType: form.articleType.trim() || null,
        abstract: form.abstract.trim() || null,
        keywords: splitKeywords(form.keywords)
      })
      toast.success(t('library.metadataSaved'))
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle>{t('library.editMetadata')}</DialogTitle>
          <DialogDescription>{t('library.subtitle')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3.5">
          <Field label={t('common.title')}>
            <Input value={form.title} onChange={(event) => update('title', event.target.value)} />
          </Field>
          <Field label={t('common.authors')} hint={t('library.authorsHint')}>
            <Input value={form.authors} onChange={(event) => update('authors', event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.journal')}>
              <Input value={form.journalTitle} onChange={(event) => update('journalTitle', event.target.value)} />
            </Field>
            <Field label={t('library.publisher')}>
              <Input value={form.publisher} onChange={(event) => update('publisher', event.target.value)} />
            </Field>
            <Field label={t('common.year')}>
              <Input value={form.year} inputMode="numeric" onChange={(event) => update('year', event.target.value)} />
            </Field>
            <Field label={t('library.publicationDate')}>
              <Input type="date" value={form.publicationDate} onChange={(event) => update('publicationDate', event.target.value)} />
            </Field>
            <Field label={t('library.volume')}>
              <Input value={form.volume} onChange={(event) => update('volume', event.target.value)} />
            </Field>
            <Field label={t('library.issue')}>
              <Input value={form.issue} onChange={(event) => update('issue', event.target.value)} />
            </Field>
            <Field label={t('library.pages')}>
              <Input value={form.pages} onChange={(event) => update('pages', event.target.value)} />
            </Field>
            <Field label={t('library.articleType')}>
              <Input value={form.articleType} onChange={(event) => update('articleType', event.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.doi')}>
              <Input value={form.doi} onChange={(event) => update('doi', event.target.value)} placeholder="10.xxxx/xxxxx" />
            </Field>
            <Field label={t('library.url')}>
              <Input value={form.url} onChange={(event) => update('url', event.target.value)} placeholder="https://…" />
            </Field>
          </div>
          <Field label={t('common.keywords')} hint={t('library.keywordsHint')}>
            <Input value={form.keywords} onChange={(event) => update('keywords', event.target.value)} />
          </Field>
          <Field label={t('common.abstract')}>
            <Textarea rows={6} value={form.abstract} onChange={(event) => update('abstract', event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? t('common.saving') : t('library.saveMetadata')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
