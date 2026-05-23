import fs from 'node:fs'

// Uses O_APPEND so the kernel chooses the append offset for each single-record
// write. Cross-file operations are not atomic across two calls; callers must
// implement idempotency guards.
export function appendJsonl(filePath: string, record: unknown): void {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`)
}

// Write-to-temp + rename is atomic on POSIX when both paths are on the same fs.
export function atomicRewriteJsonl(filePath: string, records: unknown[]): void {
  const tmp = `${filePath}.tmp`
  const content = records.map((record) => JSON.stringify(record)).join('\n')
  fs.writeFileSync(tmp, content.length > 0 ? `${content}\n` : '')
  fs.renameSync(tmp, filePath)
}
