import fs from 'node:fs'
import type { BoundedJob } from '@roundtable/shared'
import { jobJsonPath, jobsDir, threadJsonPath } from './paths'
import { nextJobCounterValue } from './counters'
import { NotFoundError } from './errors'

export function nextJobId(dataDir: string, threadId: string): string {
  return `job-${String(nextJobCounterValue(dataDir, threadId)).padStart(3, '0')}`
}

export function listJobs(dataDir: string, threadId: string): BoundedJob[] {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const dir = jobsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((file) => /^job-\d+\.json$/.test(file))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8')) as BoundedJob)
}

export function getJob(
  dataDir: string,
  threadId: string,
  jobId: string,
): BoundedJob | null {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const filePath = jobJsonPath(dataDir, threadId, jobId)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as BoundedJob
}

export function writeJob(dataDir: string, job: BoundedJob): BoundedJob {
  fs.mkdirSync(jobsDir(dataDir, job.thread_id), { recursive: true })
  const filePath = jobJsonPath(dataDir, job.thread_id, job.id)
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2))
  fs.renameSync(tmp, filePath)
  return job
}
