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
const host = process.env.ROUNDTABLE_HOST ?? '127.0.0.1'
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

server.listen(port, host, () => {
  const openUrl = ['0.0.0.0', '::'].includes(host) ? `http://localhost:${port}` : `http://${host}:${port}`
  console.log(`Roundtable backend listening on ${openUrl}`)
  if (openUrl !== `http://${host}:${port}`) {
    console.log(`Bound to ${host}:${port}`)
  }
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    console.warn(
      `Roundtable is bound to ${host} with no general API authentication. Anyone who can reach this address can run agents and read thread data.`,
    )
  }
  console.log(`Data directory: ${dataDir}`)
})
