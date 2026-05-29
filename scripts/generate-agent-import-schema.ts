import fs from 'node:fs'
import path from 'node:path'
import { renderAgentImportSchema } from './agentImportSchema'

const outputPath = path.resolve('packages/frontend/public/agent-import.schema.json')

fs.writeFileSync(outputPath, renderAgentImportSchema())
