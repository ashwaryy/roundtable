import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { createApp } from './server'
import { createBroadcastHub } from './ws'
import { createStorage } from './storage'
import { validateAllMonotonicCounters } from './storage/counters'
import { resolveDataDir } from './storage/paths'
import { createRoomManager } from './rooms/manager'

const dataDir = resolveDataDir()
const port = Number(process.env.ROUNDTABLE_PORT ?? 4319)
const backendUrl = process.env.ROUNDTABLE_BACKEND_URL ?? `http://localhost:${port}`
const frontendDistDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url))

validateAllMonotonicCounters(dataDir)

const server = http.createServer()
const wss = new WebSocketServer({ server, path: '/ws' })
const hub = createBroadcastHub(wss)
const storage = createStorage(dataDir, hub.broadcast)
const rooms = createRoomManager({
  dataDir,
  backendUrl,
  onUpdate: hub.broadcast,
  onCanonicalWrite: storage.acceptIntegrity,
})

const app = createApp({
  storage,
  rooms,
  broadcast: hub.broadcast,
  frontendDistDir: fs.existsSync(path.join(frontendDistDir, 'index.html')) ? frontendDistDir : null,
})
server.on('request', app)

server.listen(port, () => {
  console.log(`Roundtable backend listening on http://localhost:${port}`)
  console.log(`Data directory: ${dataDir}`)
})
