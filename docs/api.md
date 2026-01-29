# API Documentation

## WebSocket API (Socket.io)

The Bridge server uses Socket.io for real-time communication with web clients.

**Connection URL:** `ws://localhost:3000`  
**Path:** `/ws`

### Client → Server Events

#### `join`
Join a board room to receive updates.

```javascript
socket.emit('join', { 
  boardId: 'stm32-01',
  token: 'optional-jwt-token' 
});
```

#### `leave`
Leave a board room.

```javascript
socket.emit('leave', { boardId: 'stm32-01' });
```

#### `command`
Send a command to a board.

```javascript
socket.emit('command', {
  boardId: 'stm32-01',
  cmd: 'DAC1',           // DAC1, DAC2, LED6, LATENCY
  value: 2048,           // 0-4095 for DAC, boolean for LED, 100-60000 for LATENCY
  origin: 'web:user123', // Optional identifier
  reqId: 'uuid-v4'       // Optional request ID for tracking
});
```

#### `getState`
Request current state for a board.

```javascript
socket.emit('getState', { boardId: 'stm32-01' });
```

#### `listBoards`
List all known boards.

```javascript
socket.emit('listBoards');
```

### Server → Client Events

#### `state`
Full state update for a board.

```javascript
socket.on('state', (data) => {
  // data: { boardId, online, lastState, lastTelemetry, lastCmd }
});
```

**State Schema:**
```json
{
  "boardId": "stm32-01",
  "online": true,
  "lastState": {
    "board_id": "stm32-01",
    "online": true,
    "ts": 1700000000000,
    "dac": { "dac1": 2048, "dac2": 1024 },
    "actuators": { "led6": true },
    "latency_ms": 1000,
    "fw": "v1.2.3"
  },
  "lastTelemetry": {
    "board_id": "stm32-01",
    "ts": 1700000000000,
    "adc": [1200, 2048, 4095, 0, 512, 1024],
    "temp": 27.6,
    "humid": 48,
    "press": 1008
  },
  "lastCmd": {
    "cmd": "DAC1",
    "value": 2048,
    "origin": "web:user",
    "reqId": "uuid",
    "ts": 1700000000000
  }
}
```

#### `telemetry`
Streaming telemetry data.

```javascript
socket.on('telemetry', ({ boardId, telemetry }) => {
  // telemetry: { adc, temp, humid, press, ts }
});
```

#### `status`
Online/offline status change.

```javascript
socket.on('status', ({ boardId, online, reason }) => {
  // reason: 'lwt' | 'timeout' | undefined
});
```

#### `command_ack`
Acknowledgment of a sent command.

```javascript
socket.on('command_ack', ({ reqId, ok, error, ts }) => {
  // ok: true/false
  // error: string if ok is false
});
```

#### `command_update`
Broadcast of command sent by any client.

```javascript
socket.on('command_update', ({ boardId, lastCmd }) => {
  // lastCmd: { cmd, value, origin, reqId, ts }
});
```

---

## REST API

### Health Check

**GET** `/health`

Returns server health status.

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "mqtt": "connected",
  "uptime": 3600
}
```

### Prometheus Metrics

**GET** `/metrics`

Returns Prometheus-format metrics.

### List Boards

**GET** `/api/boards`

Returns all known boards.

**Headers:** `Authorization: Bearer <token>` (in production)

```json
{
  "boards": {
    "stm32-01": {
      "online": true,
      "clients": 3,
      "lastSeen": 1700000000000
    }
  }
}
```

### Get Board State

**GET** `/api/state/:boardId`

Returns state for a specific board.

### Send Command (REST)

**POST** `/api/command/:boardId`

Send a command via REST API.

**Body:**
```json
{
  "cmd": "DAC1",
  "value": 2048
}
```

**Response:**
```json
{
  "success": true,
  "reqId": "rest-1700000000000-abc123",
  "message": "Command published"
}
```

### Generate Token (Development)

**POST** `/api/auth/token`

Generate a JWT token (development only).

**Body:**
```json
{
  "userId": "user123",
  "role": "admin"
}
```

**Response:**
```json
{
  "token": "eyJhbG...",
  "expiresIn": "24h"
}
```

---

## MQTT Topics

### Telemetry (Device → Broker)

**Topic:** `stm32/<board_id>/telemetry`  
**Retained:** No  
**QoS:** 0 or 1

```json
{
  "board_id": "stm32-01",
  "ts": 1700000000000,
  "seq": 123,
  "adc": [1200, 2048, 4095, 0, 512, 1024],
  "temp": 27.6,
  "humid": 48,
  "press": 1008
}
```

### State (Device → Broker)

**Topic:** `stm32/<board_id>/state`  
**Retained:** Yes  
**QoS:** 1

```json
{
  "board_id": "stm32-01",
  "online": true,
  "ts": 1700000000000,
  "uptime_ms": 1234567,
  "dac": { "dac1": 2048, "dac2": 1024 },
  "actuators": { "led6": true },
  "latency_ms": 1000,
  "fw": "v1.2.3"
}
```

### Commands (Server → Device)

**Topic:** `stm32/<board_id>/commands`  
**Retained:** No  
**QoS:** 1

```json
{
  "cmd": "DAC1",
  "value": 2048,
  "origin": "web:user",
  "reqId": "uuid-v4",
  "ts": 1700000000000
}
```

### Status / LWT

**Topic:** `stm32/<board_id>/status`  
**Retained:** Yes

```json
{
  "online": false,
  "ts": 1700000000000
}
```

---

## Command Types

| Command | Value Type | Range | Description |
|---------|-----------|-------|-------------|
| `DAC1` | number | 0-4095 | Set DAC channel 1 output |
| `DAC2` | number | 0-4095 | Set DAC channel 2 output |
| `LED6` | boolean | true/false | Toggle LED6 |
| `LATENCY` | number | 100-60000 | Set telemetry interval (ms) |
