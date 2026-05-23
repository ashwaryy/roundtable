import http from 'node:http'
import { WebSocketServer } from 'ws'
import { createApp } from './server'
import { createBroadcastHub } from './ws'
import { createStorage } from './storage'
import { resolveDataDir } from './storage/paths'

const dataDir = resolveDataDir()
const port = Number(process.env.ROUNDTABLE_PORT ?? 4319)

const storage = createStorage(dataDir)
const server = http.createServer()
const wss = new WebSocketServer({ server, path: '/ws' })
const hub = createBroadcastHub(wss)

const app = createApp({ storage, broadcast: hub.broadcast })
server.on('request', app)

server.listen(port, () => {
  console.log(`Roundtable backend listening on http://localhost:${port}`)
  console.log(`Data directory: ${dataDir}`)
})
