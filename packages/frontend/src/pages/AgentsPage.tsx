import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AgentColorPreset, AgentPersona, AgentRuntime } from '@roundtable/shared'
import { createAgent, deleteAgent, importAgents, listAgents, updateAgent } from '../api'
import { Avatar, Icon } from '../components/primitives'
import { ModelSelect } from '../components/ModelSelect'
import { ThemeToggle } from '../components/ThemeToggle'

const COLORS: AgentColorPreset[] = ['blue', 'green', 'amber', 'rose', 'violet', 'teal']

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentPersona[]>([])
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
  const [error, setError] = useState<string | null>(null)

  function refresh() { listAgents().then(setAgents).catch((err) => setError(String(err))) }
  useEffect(refresh, [])

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

  function edit(agent: AgentPersona) {
    setEditingId(agent.id)
    setName(agent.name)
    setRuntime(agent.runtime)
    setRole(agent.role_description)
    setInstructions(agent.instructions)
    setModel(agent.model ?? '')
    setEffort(agent.effort ?? '')
    setColor(agent.color)
    setError(null)
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
      refresh()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function archive(agent: AgentPersona) {
    await deleteAgent(agent.id)
    refresh()
  }

  async function restore(agent: AgentPersona) {
    await updateAgent(agent.id, { archived: false })
    refresh()
  }

  async function doImport() {
    try {
      await importAgents(importText)
      setImportText('')
      refresh()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
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
          </div>
          <p className="agents-description">
            Define the AI commenters available for your threads and the roles they bring to a discussion.
          </p>
        </header>
        <div className="agents-layout">
          <section className="panel agents-catalogue-panel">
            <div className="agents-section-head">
              <h2 className="h-2">Personas</h2>
              <span>{agents.length} configured</span>
            </div>
            <div className="agent-catalogue">
              {agents.map((agent) => (
                <div className="catalogue-row" key={agent.id} data-archived={agent.archived}>
                  <Avatar author={agent.id} persona={agent} size={28} />
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
          <section className="panel agents-form-panel">
            <h2 className="h-2">{editingId ? 'Edit persona' : 'New persona'}</h2>
            <form className="rail-form" onSubmit={submit}>
              <input className="input" required placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
              <select className="input" value={runtime} onChange={(e) => setRuntime(e.target.value as AgentRuntime)}>
                <option value="codex">Codex runtime</option><option value="claude">Claude runtime</option>
              </select>
              <input className="input" placeholder="Role description" value={role} onChange={(e) => setRole(e.target.value)} />
              <textarea className="textarea" placeholder="Persona instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              <div className="rail-row">
                <ModelSelect key={`${formVersion}-${editingId ?? 'new'}-${runtime}`} runtime={runtime} value={model} onChange={setModel} ariaLabel="Persona model" />
                <select className="input" value={effort} onChange={(e) => setEffort(e.target.value)}><option value="">Default effort</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>{runtime === 'codex' ? <option value="xhigh">Extra high</option> : null}</select>
              </div>
              <div className="color-picker">{COLORS.map((preset) => <button type="button" key={preset} className={`swatch swatch-${preset} ${color === preset ? 'selected' : ''}`} aria-label={preset} onClick={() => setColor(preset)} />)}</div>
              <div className="pending-actions">
                <button className="btn primary" type="submit">
                  <Icon name={editingId ? 'check' : 'plus'} className="ic-sm" />
                  {editingId ? 'Save persona' : 'Add persona'}
                </button>
                {editingId ? <button className="btn" type="button" onClick={clearForm}>Cancel</button> : null}
              </div>
            </form>
            <div className="agents-import">
              <h2 className="h-2">Import JSON</h2>
              <textarea className="textarea" placeholder='{"name":"Architect","runtime":"codex","color":"teal"}' value={importText} onChange={(e) => setImportText(e.target.value)} />
              <button type="button" className="btn" disabled={!importText.trim()} onClick={doImport}>Import</button>
            </div>
            {error ? <p className="agents-error" role="alert">{error}</p> : null}
          </section>
        </div>
      </main>
    </>
  )
}
