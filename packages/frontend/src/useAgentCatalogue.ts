import { useQuery } from '@tanstack/react-query'
import type { Agent } from '@roundtable/shared'
import { listAgents } from './api'
import { roundtableQueryKeys } from './query'

export function useAgentCatalogue() {
  const { data } = useQuery({
    queryKey: roundtableQueryKeys.agents.list(),
    queryFn: listAgents,
    select: (items: Agent[]) => items.filter((item) => !item.archived),
  })

  return data ?? []
}
