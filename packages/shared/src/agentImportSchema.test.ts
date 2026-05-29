import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAgentImportSchema, renderAgentImportSchema } from '../../../scripts/agentImportSchema'

describe('agent-import schema generation', () => {
  it('includes runtime-specific effort enums and updated effort description', () => {
    const schema = buildAgentImportSchema() as {
      $defs: {
        agentImport: {
          properties: {
            effort: { description: string }
          }
          allOf: Array<{ then: { properties: { effort: { enum: Array<string | null> } } } }>
        }
      }
    }
    const agentImport = schema.$defs.agentImport

    expect(agentImport.properties.effort.description).toContain('Claude supports low, medium, high, xhigh, and max.')
    expect(agentImport.properties.effort.description).toContain('Codex supports low, medium, high, and xhigh.')
    expect(agentImport.allOf[0].then.properties.effort.enum).toEqual(['low', 'medium', 'high', 'xhigh', null])
    expect(agentImport.allOf[1].then.properties.effort.enum).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      null,
    ])
  })

  it('fails on schema drift', () => {
    const schemaPath = path.resolve('packages/frontend/public/agent-import.schema.json')
    const committed = fs.readFileSync(schemaPath, 'utf8')

    expect(committed).toBe(renderAgentImportSchema())
  })
})
