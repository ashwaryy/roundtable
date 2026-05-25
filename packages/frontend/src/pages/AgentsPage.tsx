import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AgentColorPreset, Agent, AgentRuntime } from '@roundtable/shared'
import { createAgent, deleteAgent, importAgents, listAgents, updateAgent } from '../api'
import { Avatar, Icon } from '../components/primitives'
import { ModelSelect } from '../components/ModelSelect'
import { ThemeToggle } from '../components/ThemeToggle'

const COLORS: AgentColorPreset[] = ['blue', 'green', 'amber', 'rose', 'violet', 'teal']

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formVersion, setFormVersion] = useState(0)
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState<AgentRuntime>('codex')
  const [role, setRole] = useState('')
  const [instructions, setInstructions] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [color, setColor] = useState<AgentColorPreset>('blue')
  const [importText, setImportText] = useState('')
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refresh() { listAgents().then(setAgents).catch((err) => setError(String(err))) }
  useEffect(refresh, [])
  useEffect(() => {
    if (!importOpen && !agentDialogOpen) return undefined
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (importOpen) {
        setImportOpen(false)
        return
      }
      setAgentDialogOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [agentDialogOpen, importOpen])

  function clearForm() {
    setFormVersion((version) => version + 1)
    setEditingId(null)
    setName('')
    setRuntime('codex')
    setRole('')
    setInstructions('')
    setModel('')
    setEffort('')
    setColor('blue')
  }

  function edit(agent: Agent) {
    setEditingId(agent.id)
    setName(agent.name)
    setRuntime(agent.runtime)
    setRole(agent.role_description)
    setInstructions(agent.instructions)
    setModel(agent.model ?? '')
    setEffort(agent.effort ?? '')
    setColor(agent.color)
    setError(null)
    setImportOpen(false)
    setAgentDialogOpen(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const input = { name, runtime, role_description: role, instructions, model: model || null, effort: effort || null, color }
      if (editingId) {
        await updateAgent(editingId, input)
      } else {
        await createAgent(input)
      }
      clearForm()
      setAgentDialogOpen(false)
      refresh()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function archive(agent: Agent) {
    await deleteAgent(agent.id)
    refresh()
  }

  async function restore(agent: Agent) {
    await updateAgent(agent.id, { archived: false })
    refresh()
  }

  async function doImport() {
    setError(null)
    try {
      await importAgents(importText)
      setImportText('')
      setImportOpen(false)
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`Import failed: ${message}`)
    }
  }

  function openImport() {
    setError(null)
    setAgentDialogOpen(false)
    setImportOpen(true)
  }

  function openCreateAgent() {
    clearForm()
    setError(null)
    setImportOpen(false)
    setAgentDialogOpen(true)
  }

  function closeAgentDialog() {
    clearForm()
    setError(null)
    setAgentDialogOpen(false)
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Roundtable home">
          <span className="dot" />
          <span>Roundtable</span>
        </Link>
        <div className="spacer" />
        <div className="meta">
          <Link className="btn" to="/">
            <Icon name="arrowLeft" className="ic-sm" />
            Threads
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="home-wrap agents-page">
        <header className="home-head agents-head">
          <div>
            <div className="eyebrow tight">Configuration</div>
            <h1 className="h-display">Agents.</h1>
            <p className="agents-description">
              Define the AI commenters available for your threads and the roles they bring to a discussion.
            </p>
          </div>
          <div className="agents-head-actions">
            <button className="btn primary" type="button" onClick={openCreateAgent}>
              <Icon name="plus" className="ic-sm" />
              Create Agent
            </button>
            <button className="btn" type="button" onClick={openImport}>
              <Icon name="file" className="ic-sm" />
              Import Agent(s)
            </button>
          </div>
        </header>
        <div className="agents-layout">
          <section className="panel agents-catalogue-panel">
            <div className="agents-section-head">
              <h2 className="h-2">Agents</h2>
              <span>{agents.length} configured</span>
            </div>
            <div className="agent-catalogue">
              {agents.map((agent) => (
                <div className="catalogue-row" key={agent.id} data-archived={agent.archived}>
                  <Avatar author={agent.id} agent={agent} size={28} />
                  <div className="agent-meta">
                    <div className="name">{agent.name}</div>
                    <div className="sub">{agent.runtime} · {agent.role_description || 'No role description'}</div>
                  </div>
                  <span className={`swatch swatch-${agent.color}`} />
                  <button className="btn sm" type="button" onClick={() => edit(agent)}>
                    Edit
                  </button>
                  <button className="btn sm" type="button" onClick={() => agent.archived ? restore(agent) : archive(agent)}>
                    {agent.archived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              ))}
            </div>
          </section>
          {error && !importOpen && !agentDialogOpen ? <p className="agents-error" role="alert">{error}</p> : null}
        </div>
      </main>
      {agentDialogOpen ? (
        <div className="modal-overlay" onClick={closeAgentDialog}>
          <section
            className="modal-panel agents-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agents-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 className="h-2" id="agents-form-title">{editingId ? 'Edit agent' : 'Create agent'}</h2>
              <button className="btn icon" type="button" aria-label="Close agent dialog" onClick={closeAgentDialog}>
                <Icon name="close" className="ic-sm" />
              </button>
            </div>
            <form className="rail-form" onSubmit={submit}>
              <input className="input" required placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
              <select className="input" value={runtime} onChange={(e) => setRuntime(e.target.value as AgentRuntime)}>
                <option value="codex">Codex runtime</option><option value="claude">Claude runtime</option>
              </select>
              <input className="input" placeholder="Role description" value={role} onChange={(e) => setRole(e.target.value)} />
              <textarea className="textarea" placeholder="Agent instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              <div className="rail-row">
                <ModelSelect key={`${formVersion}-${editingId ?? 'new'}-${runtime}`} runtime={runtime} value={model} onChange={setModel} ariaLabel="Agent model" />
                <select className="input" value={effort} onChange={(e) => setEffort(e.target.value)}><option value="">Default effort</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>{runtime === 'codex' ? <option value="xhigh">Extra high</option> : null}</select>
              </div>
              <div className="color-picker">{COLORS.map((preset) => <button type="button" key={preset} className={`swatch swatch-${preset} ${color === preset ? 'selected' : ''}`} aria-label={preset} onClick={() => setColor(preset)} />)}</div>
              <div className="pending-actions">
                <button className="btn primary" type="submit">
                  <Icon name={editingId ? 'check' : 'plus'} className="ic-sm" />
                  {editingId ? 'Save agent' : 'Create agent'}
                </button>
                <button className="btn" type="button" onClick={closeAgentDialog}>Cancel</button>
              </div>
            </form>
            {error ? <p className="agents-error" role="alert">{error}</p> : null}
          </section>
        </div>
      ) : null}
      {importOpen ? (
        <div className="modal-overlay" onClick={() => setImportOpen(false)}>
          <section
            className="modal-panel agents-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agents-import-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 className="h-2" id="agents-import-title">Import JSON</h2>
              <button className="btn icon" type="button" aria-label="Close import dialog" onClick={() => setImportOpen(false)}>
                <Icon name="close" className="ic-sm" />
              </button>
            </div>
            <div className="agents-import">
              <div className="agents-import-options" aria-label="Import JSON options">
                <span className="import-option active">Paste</span>
                <a className="btn" href="/agent-import.sample.json" download>
                  <Icon name="file" className="ic-sm" />
                  Sample
                </a>
                <a className="btn" href="/agent-import.schema.json" download>
                  <Icon name="file" className="ic-sm" />
                  Schema
                </a>
              </div>
              <textarea
                className="textarea"
                placeholder={`[
  {
    "name": "Architect",
    "runtime": "codex",
    "role_description": "System design reviewer",
    "instructions": "Focus on tradeoffs and concrete revisions.",
    "model": null,
    "effort": "high",
    "color": "teal",
    "logo_url": null
  }
]`}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="agents-import-actions">
                <button type="button" className="btn" disabled={!importText.trim()} onClick={doImport}>Import</button>
              </div>
            </div>
            {error ? <p className="agents-error" role="alert">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  )
}
