import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import aedes from 'aedes'
import mqtt from 'mqtt'
import { WebSocketServer, createWebSocketStream } from 'ws'

const require = createRequire(import.meta.url)
const topic = process.env.HOME_TOPIC ?? 'nhathongminh/esp32-ec2d91386fb37524'
const remoteUrl = process.env.MQTT_REMOTE ?? 'mqtt://broker.hivemq.com:1883'
const mqttPort = Number(process.env.MQTT_PORT ?? 1883)
const webPort = Number(process.env.WEB_PORT ?? 5173)
const mqttHost = process.env.MQTT_HOST ?? '127.0.0.1'
const stateTopic = topic + '/state'
const commandTopic = topic + '/cmd/+'
const broker = aedes()
const tcp = createTcpServer(broker.handle)

const pages = new Map([
  ['/', ['text/html; charset=utf-8', new URL('../frontend/index.html', import.meta.url)]],
  ['/style.css', ['text/css; charset=utf-8', new URL('../frontend/style.css', import.meta.url)]],
  ['/app.js', ['text/javascript; charset=utf-8', new URL('../frontend/app.js', import.meta.url)]],
  ['/vendor/mqtt.js', ['text/javascript; charset=utf-8', resolve(require.resolve('mqtt/package.json'), '../dist/mqtt.min.js')]],
])
const http = createHttpServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  if (req.url === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ topic, remote: remoteUrl || null }))
    return
  }
  const page = pages.get(req.url)
  if (!page) {
    res.writeHead(404).end('Không tìm thấy trang')
    return
  }
  try {
    const content = await readFile(page[1])
    res.writeHead(200, { 'Content-Type': page[0], 'X-Content-Type-Options': 'nosniff' })
    res.end(content)
  } catch (error) {
    console.error(error.message)
    res.writeHead(500).end('Không tải được tài nguyên')
  }
})

const ws = new WebSocketServer({ noServer: true, maxPayload: 16384 })
http.on('upgrade', (request, socket, head) => {
  const validOrigin = request.headers.origin === 'http://' + request.headers.host
  if (request.url !== '/mqtt' || !validOrigin) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  ws.handleUpgrade(request, socket, head, (client) => {
    broker.handle(createWebSocketStream(client))
  })
})

function startBridge() {
  const options = { keepalive: 20, connectTimeout: 6000, reconnectPeriod: 2500, queueQoSZero: false }
  const localHost = mqttHost === '0.0.0.0' ? '127.0.0.1' : mqttHost
  const local = mqtt.connect('mqtt://' + localHost + ':' + mqttPort, options)
  const remote = mqtt.connect(remoteUrl, options)

  local.on('connect', () => local.subscribe(commandTopic))
  remote.on('connect', () => {
    console.log('Bridge MQTT đã kết nối: %s', remoteUrl)
    remote.subscribe(stateTopic)
  })
  local.on('message', (destination, payload, packet) => {
    if (remote.connected && !packet.retain) remote.publish(destination, payload)
  })
  remote.on('message', (destination, payload, packet) => {
    if (local.connected && !packet.retain) local.publish(destination, payload)
  })
  local.on('error', (error) => console.error('Bridge nội bộ:', error.message))
  remote.on('error', (error) => console.error('Bridge Wokwi:', error.message || error.code || error))
}

for (const server of [tcp, http]) {
  server.on('error', (error) => {
    console.error(error.message)
    process.exit(1)
  })
}
tcp.listen(mqttPort, mqttHost, () => {
  console.log('Broker MQTT: mqtt://%s:%s · %s', mqttHost, mqttPort, topic)
  if (remoteUrl) startBridge()
})
http.listen(webPort, '127.0.0.1', () => {
  console.log('Giao diện: http://localhost:%s', webPort)
})
