import type { JobRepo } from '../../db/repositories/jobs'
import type { ClassifierService } from './classifier'

interface QueueItem {
  jobId: string
  ids: string[]
  force: boolean
  keywordCount?: number
  allowNewCategories?: boolean
  maxNewCategories?: number
  discoverySampleSize?: number
  includeFullText?: boolean
  thinkingDepth?: 'low' | 'medium-low' | 'high'
  requireAssignment?: boolean
}

function shuffle<T>(input: T[]): T[] {
  const list = [...input]
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[list[index], list[swap]] = [list[swap], list[index]]
  }
  return list
}

export class ClassificationQueue {
  private readonly queue: QueueItem[] = []
  private running = false
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly classifier: ClassifierService,
    private readonly jobs: JobRepo,
    private readonly emit: (type: 'job:progress' | 'articles:changed', payload?: unknown) => void
  ) {}

  enqueue(
    articleIds: string[],
    options: {
      force?: boolean
      keywordCount?: number
      allowNewCategories?: boolean
      maxNewCategories?: number
      discoverySampleSize?: number
      includeFullText?: boolean
      thinkingDepth?: 'low' | 'medium-low' | 'high'
      requireAssignment?: boolean
    } = {}
  ): string | null {
    const ids = [...new Set(articleIds)].filter((id) => !this.inFlight.has(id))
    if (!ids.length) return null
    const job = this.jobs.create('classification', { count: ids.length })
    for (const id of ids) this.inFlight.add(id)
    this.queue.push({
      jobId: job.id,
      ids,
      force: options.force ?? false,
      keywordCount: options.keywordCount,
      allowNewCategories: options.allowNewCategories,
      maxNewCategories: options.maxNewCategories,
      discoverySampleSize: options.discoverySampleSize,
      includeFullText: options.includeFullText,
      thinkingDepth: options.thinkingDepth,
      requireAssignment: options.requireAssignment
    })
    this.emit('job:progress', { jobId: job.id, type: 'classification', progress: 0, message: 'Queued' })
    void this.process()
    return job.id
  }

  private async process(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const item = this.queue.shift()
        if (!item) continue
        this.jobs.start(item.jobId)
        const total = item.ids.length
        try {
          const report = (offset: number) => (done: number, _count: number, currentId: string) => {
            const processed = offset + done
            const progress = total ? processed / total : 0
            this.jobs.progress(item.jobId, progress, `${processed}/${total}`)
            this.emit('job:progress', {
              jobId: item.jobId,
              type: 'classification',
              progress,
              message: `${processed}/${total}`,
              currentId
            })
          }
          const sampleSize = Math.max(0, Math.min(total, Math.round(item.discoverySampleSize ?? 0)))
          const useDiscovery =
            sampleSize > 0 && (item.maxNewCategories ?? 0) > 0 && item.allowNewCategories !== false
          let result: { succeeded: number; failed: number; errors: string[] }
          if (useDiscovery) {
            const shuffled = shuffle(item.ids)
            const sample = shuffled.slice(0, sampleSize)
            const rest = shuffled.slice(sampleSize)
            const sampleResult = await this.classifier.classifyMany(
              sample,
              {
                force: item.force,
                keywordCount: item.keywordCount,
                allowNewCategories: true,
                maxNewCategories: item.maxNewCategories,
                includeFullText: item.includeFullText,
                thinkingDepth: item.thinkingDepth,
                requireAssignment: item.requireAssignment
              },
              report(0)
            )
            const restResult = await this.classifier.classifyMany(
              rest,
              {
                force: item.force,
                keywordCount: item.keywordCount,
                allowNewCategories: false,
                maxNewCategories: 0,
                includeFullText: item.includeFullText,
                thinkingDepth: item.thinkingDepth,
                requireAssignment: item.requireAssignment
              },
              report(sample.length)
            )
            result = {
              succeeded: sampleResult.succeeded + restResult.succeeded,
              failed: sampleResult.failed + restResult.failed,
              errors: [...sampleResult.errors, ...restResult.errors]
            }
          } else {
            result = await this.classifier.classifyMany(
              item.ids,
              {
                force: item.force,
                keywordCount: item.keywordCount,
                allowNewCategories: false,
                maxNewCategories: 0,
                includeFullText: item.includeFullText,
                thinkingDepth: item.thinkingDepth,
                requireAssignment: item.requireAssignment
              },
              report(0)
            )
          }
          this.jobs.succeed(item.jobId, result)
          this.emit('job:progress', {
            jobId: item.jobId,
            type: 'classification',
            progress: 1,
            message: `Finished: ${result.succeeded} classified, ${result.failed} failed`,
            result
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.jobs.fail(item.jobId, message)
          this.emit('job:progress', {
            jobId: item.jobId,
            type: 'classification',
            progress: 1,
            message,
            error: message
          })
        } finally {
          for (const id of item.ids) this.inFlight.delete(id)
          this.emit('articles:changed', { reason: 'classification-finished' })
        }
      }
    } finally {
      this.running = false
    }
  }

  isBusy(): boolean {
    return this.running || this.queue.length > 0
  }
}
