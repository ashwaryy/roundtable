import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SystemPromptRuntime, SystemPromptSection } from '@roundtable/shared'
import { getSystemInfo, listSystemPrompts } from '../api'
import { TopbarHeader } from '../components/AppHeader'
import { Icon } from '../components/primitives'
import { roundtableQueryKeys } from '../query'
import { ThemeToggle } from '../components/ThemeToggle'
import { useLiveRefresh } from '../useLiveRefresh'

const RUNTIME_LABELS: Record<SystemPromptRuntime | 'all', string> = {
  all: 'All',
  common: 'Common',
  claude: 'Claude',
  codex: 'Codex',
}

function languageFor(section: SystemPromptSection): string {
  if (section.kind === 'runtime_config' && section.id.includes('codex')) return 'toml'
  if (section.kind === 'runtime_config' && section.id.includes('claude')) return 'json'
  if (section.kind === 'runtime_rules') return 'ruby'
  if (section.kind === 'launch_command') return 'sh'
  return 'markdown'
}

export function SystemPage() {
  const [runtime, setRuntime] = useState<SystemPromptRuntime | 'all'>('all')
  const backendStatus = useLiveRefresh(() => {})
  const [sectionsQuery, systemInfoQuery] = useQueries({
    queries: [
      {
        queryKey: roundtableQueryKeys.system.prompts(),
        queryFn: listSystemPrompts,
      },
      {
        queryKey: roundtableQueryKeys.system.info(),
        queryFn: getSystemInfo,
      },
    ],
  })
  const sections = sectionsQuery.data ?? []
  const systemInfo = systemInfoQuery.data ?? null
  const error = sectionsQuery.error ?? systemInfoQuery.error

  const visible = useMemo(
    () => runtime === 'all' ? sections : sections.filter((section) => section.runtime === runtime),
    [runtime, sections],
  )

  const counts = useMemo(() => {
    const base: Record<SystemPromptRuntime | 'all', number> = {
      all: sections.length,
      common: 0,
      claude: 0,
      codex: 0,
    }
    for (const section of sections) base[section.runtime] += 1
    return base
  }, [sections])

  return (
    <>
      <TopbarHeader
        backendStatus={backendStatus}
        actions={
          <>
          <Link className="btn" to="/agents">
            <Icon name="settings" className="ic-sm" />
            Agents
          </Link>
          <Link className="btn" to="/">
            <Icon name="arrowLeft" className="ic-sm" />
            Threads
          </Link>
          <ThemeToggle />
          </>
        }
      />
      <main className="home-wrap system-page">
        <header className="home-head system-head">
          <div>
            <div className="eyebrow tight">Runtime surface</div>
            <h1 className="h-display">System.</h1>
            <p className="system-description">
              Live Roundtable prompt, launch, and runtime policy templates, with where each one is used.
            </p>
            <p className="system-description">Release version {systemInfo?.version ?? '...'}</p>
          </div>
        </header>
        <div className="system-tabs" role="tablist" aria-label="System prompt runtime filter">
          {(['all', 'common', 'claude', 'codex'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="filter-tab"
              data-on={runtime === item ? '1' : undefined}
              onClick={() => setRuntime(item)}
            >
              {RUNTIME_LABELS[item]}
              <span className="count">{counts[item]}</span>
            </button>
          ))}
        </div>
        {error ? <p className="agents-error" role="alert">{error instanceof Error ? error.message : String(error)}</p> : null}
        <div className="system-sections">
          {visible.map((section) => (
            <article className="system-section" key={section.id}>
              <header className="system-section-head">
                <div>
                  <div className="system-kicker">
                    <span>{RUNTIME_LABELS[section.runtime]}</span>
                    <span>{section.kind.replace(/_/g, ' ')}</span>
                  </div>
                  <h2 className="h-2">{section.title}</h2>
                </div>
              </header>
              <dl className="system-meta-list">
                <div>
                  <dt>Used By</dt>
                  <dd>{section.used_by}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{section.source}</dd>
                </div>
              </dl>
              {section.notes.length > 0 ? (
                <ul className="system-notes">
                  {section.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              ) : null}
              <pre className="system-code">
                <code data-language={languageFor(section)}>{section.content}</code>
              </pre>
            </article>
          ))}
        </div>
      </main>
    </>
  )
}
