import { useEffect, useState } from 'react'
import type { Agent } from '@roundtable/shared'
import { listAgents } from './api'

export function useAgentCatalogue() {
  const [agents, setAgents] = useState<Agent[]>([])

  useEffect(() => {
    listAgents().then((items) => setAgents(items.filter((item) => !item.archived)))
  }, [])

  return agents
}
