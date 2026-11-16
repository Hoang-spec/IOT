const byId = (id) => document.getElementById(id)
const buttons = [...document.querySelectorAll('button[data-device]')]
const modeNames = { AUTO: 'Tự động', ON: 'Bật thủ công', OFF: 'Tắt thủ công' }
const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
let lastSeen = 0
let state = null
let pendingCommand = null
const activity = []
byId('today').textContent = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

function addActivity(message) {
  activity.unshift({ message, time: new Date() })
  activity.splice(6)
  const list = byId('activity-list')
  list.replaceChildren(...activity.map(({ message, time }) => {
    const row = document.createElement('div')
    row.className = 'activity-item'
    const text = document.createElement('span')
    text.textContent = message
    const stamp = document.createElement('time')
    stamp.textContent = time.toLocaleTimeString('vi-VN')
    row.append(text, stamp)
    return row
  }))
}

function recordChanges(previous, next) {
  if (!previous) { addActivity('Đã nhận trạng thái từ ESP32'); return }
  const labels = {
    lamp: ['Đèn đã tắt', 'Đèn đã bật'], fan: ['Quạt đã tắt', 'Quạt đã bật'],
    door: ['Cửa đã đóng', 'Cửa đã mở'], armed: ['Đã tắt giám sát', 'Đã bật giám sát'],
    motion: ['Không còn chuyển động', 'Phát hiện chuyển động'], alarm: ['Còi đã tắt', 'Còi đang kêu'],
  }
  for (const [key, messages] of Object.entries(labels)) {
    if (previous[key] !== next[key]) addActivity(messages[Number(next[key])])
  }
}

function showConnection(id, label, online) {
  const element = byId(id)
  if (element.textContent !== label) element.textContent = label
  element.classList.toggle('online', online)
}

function render(client) {
  const online = client.connected && Date.now() - lastSeen < 9000 && state !== null
  showConnection('broker', client.connected ? 'Broker đã kết nối' : 'Đang kết nối broker', client.connected)
  showConnection('device', online ? 'ESP32 đang hoạt động' : 'Đang chờ ESP32', online)
  for (const key of ['temperature', 'humidity', 'light']) {
    byId(key).textContent = online && Number.isFinite(state[key]) ? numberFormat.format(state[key]) : '—'
  }
  byId('motion').textContent = online ? (state.motion ? 'Phát hiện' : 'Yên tĩnh') : '—'
  for (const key of ['lamp', 'fan']) {
    byId(key).textContent = online ? (state[key] ? 'Đang bật' : 'Đang tắt') + ' · ' + modeNames[state[key + 'Mode']] : '—'
  }
  byId('door').textContent = online ? (state.door ? 'Đang mở' : 'Đã đóng') : '—'
  byId('armed').textContent = online ? (state.armed ? 'Đang giám sát' : 'Đã tắt giám sát') : '—'
  byId('alarm').textContent = online ? (state.alarm ? 'Còi đang kêu' : 'Còi đang tắt') : 'Còi —'
  byId('alarm').classList.toggle('alert', Boolean(online && state.alarm))
  byId('last-seen').textContent = lastSeen ? 'Nhận gói gần nhất lúc ' + new Date(lastSeen).toLocaleTimeString('vi-VN') : 'Chưa nhận dữ liệu'
  for (const button of buttons) {
    button.disabled = !online
    if (button.dataset.device !== 'door') {
      const selected = online && state[button.dataset.device + 'Mode'] === button.dataset.value
      button.setAttribute('aria-pressed', String(selected))
    }
  }
}

function validState(value) {
  return value && Number.isInteger(value.light)
    && ['temperature', 'humidity'].every((key) => value[key] === null || Number.isFinite(value[key]))
    && ['motion', 'armed', 'alarm', 'lamp', 'fan', 'door'].every((key) => typeof value[key] === 'boolean')
    && ['lampMode', 'fanMode'].every((key) => Object.hasOwn(modeNames, value[key]))
}

async function start() {
  const response = await fetch('/config.json')
  if (!response.ok) throw new Error('Không tải được cấu hình broker')
  const { topic } = await response.json()
  const client = window.mqtt.connect('ws://' + location.host + '/mqtt', {
    protocolVersion: 4, keepalive: 20, reconnectPeriod: 2000, queueQoSZero: false,
  })
  const stateTopic = topic + '/state'
  client.on('connect', () => {
    client.subscribe(stateTopic)
    render(client)
  })
  client.on('close', () => {
    if (pendingCommand) {
      pendingCommand = null
      byId('feedback').textContent = 'Mất kết nối khi đang chờ trạng thái.'
    }
    state = null
    render(client)
  })
  client.on('error', () => render(client))
  client.on('message', (receivedTopic, payload, packet) => {
    if (receivedTopic !== stateTopic || packet.retain) return
    let value
    try { value = JSON.parse(payload.toString()) } catch { return }
    if (!validState(value)) return
    recordChanges(state, value)
    state = value
    lastSeen = Date.now()
    if (pendingCommand && value[pendingCommand.key] === pendingCommand.expected) {
      pendingCommand = null
      byId('feedback').textContent = 'ESP32 đã gửi trạng thái khớp với lệnh.'
    }
    render(client)
  })
  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (!client.connected || button.disabled) return
      const { device, value } = button.dataset
      pendingCommand = device === 'door'
        ? { key: 'door', expected: value === 'OPEN', sentAt: Date.now() }
        : { key: device + 'Mode', expected: value, sentAt: Date.now() }
      byId('feedback').textContent = 'Đã gửi lệnh. Đang chờ trạng thái từ ESP32…'
      client.publish(topic + '/cmd/' + device, value, { qos: 0, retain: false })
    })
  }
  setInterval(() => {
    if (pendingCommand && Date.now() - pendingCommand.sentAt > 7000) {
      pendingCommand = null
      byId('feedback').textContent = 'Chưa nhận được trạng thái khớp với lệnh.'
    }
    render(client)
  }, 500)
}

start().catch((error) => {
  showConnection('broker', 'Không thể kết nối broker', false)
  byId('feedback').textContent = error.message
})
