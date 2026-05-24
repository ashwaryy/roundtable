import type { IntegrityReport } from '@roundtable/shared'
import { acknowledgeIntegrity } from '../api'

export function IntegrityPanel({
  threadId,
  report,
  onUpdate,
}: {
  threadId: string
  report: IntegrityReport | null
  onUpdate: () => void
}) {
  if (!report || report.issues.length === 0) return null

  async function acknowledge() {
    await acknowledgeIntegrity(threadId)
    onUpdate()
  }

  return (
    <section className="panel warning-panel" aria-label="integrity-warning">
      <h2>Canonical Files Changed</h2>
      <p>
        Files owned by Roundtable changed outside the application. Actions remain available,
        but review these changes before continuing.
      </p>
      <ul>
        {report.issues.map((issue) => (
          <li key={`${issue.kind}:${issue.path}`}>
            <strong>{issue.kind}</strong>: {issue.path}
          </li>
        ))}
      </ul>
      <button type="button" onClick={acknowledge}>
        Acknowledge Current State
      </button>
    </section>
  )
}
