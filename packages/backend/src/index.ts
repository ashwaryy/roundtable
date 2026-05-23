import http from 'node:http'
import { WebSocketServer } from 'ws'
import { createApp } from './server'
import { createBroadcastHub } from './ws'
import { createStorage } from './storage'
import { resolveDataDir } from './storage/paths'
import { createRoomManager } from './rooms/manager'

const dataDir = resolveDataDir()
const port = Number(process.env.ROUNDTABLE_PORT ?? 4319)
const backendUrl = process.env.ROUNDTABLE_BACKEND_URL ?? `http://localhost:${port}`

const storage = createStorage(dataDir)
const server = http.createServer()
const wss = new WebSocketServer({ server, path: '/ws' })
const hub = createBroadcastHub(wss)
const rooms = createRoomManager({
  dataDir,
  backendUrl,
  onUpdate: hub.broadcast,
})

const app = createApp({ storage, rooms, broadcast: hub.broadcast })
server.on('request', app)

server.listen(port, () => {
  console.log(`Roundtable backend listening on http://localhost:${port}`)
  console.log(`Data directory: ${dataDir}`)
})
