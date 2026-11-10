import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Author, Language } from '@shared/types'
import type { TranslationKey } from '../i18n/translations'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDate(value?: string | null, language: Language = 'zh'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function formatDateTime(value?: string | null, language: Language = 'zh'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function relativeTime(
  value: string | null | undefined,
  language: Language,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string {
  if (!value) return t('common.never')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('common.justNow')
  if (minutes < 60) return t('common.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('common.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('common.daysAgo', { n: days })
  return formatDate(value, language)
}

export function authorNames(authors: Author[]): string[] {
  return authors.map((author) => author.name)
}

export function formatAuthors(authors: Author[] | string[], max = 3): string {
  const names = (authors as Array<Author | string>).map((author) => (typeof author === 'string' ? author : author.name))
  if (!names.length) return '—'
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} et al.`
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function splitKeywords(value: string): string[] {
  return value
    .split(/[,;，；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function splitAuthors(value: string): string[] {
  return value
    .split(/[;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function formatBytes(size?: number): string {
  if (!size) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
  return String(error)
}

export function truncateText(value: string | null | undefined, max: number): string {
  if (!value) return ''
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

export function htmlToText(value: string): string {
  return value.replace(/<[^>]+>/g, '')
}

export function isDuplicateName(value: string, existing: string[]): boolean {
  const normalized = value.trim().toLowerCase()
  return existing.some((item) => item.trim().toLowerCase() === normalized)
}
