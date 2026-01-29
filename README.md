# STM32 Dashboard + Bridge + SCADA Gateway

An authoritative MQTT Bridge with responsive Web Dashboard and SCADA Gateway (Modbus TCP) for STM32 microcontroller control systems.

## Features

- **Authoritative State Management**: Server maintains the source of truth for device state
- **Real-time Multi-client Sync**: All connected clients receive updates within <1s
- **Responsive Dashboard**: Baroque/industrial themed UI, works on phone/tablet/desktop
- **ON/OFF Control**: Hysteresis-based control with PV%, Setpoint%, and automatic output
- **SCADA Integration**: Modbus TCP server for third-party PLC/SCADA systems
- **Presence Detection**: Accurate online/offline status via LWT and heartbeat
- **Secure**: JWT authentication, rate limiting, audit logging

## Architecture

```
[STM32 device(s)]  <--> MQTT Broker <--> [Bridge Server (Node.js)]
                                         ├─ WebSocket/socket.io -> Web Dashboard
                                         ├─ Modbus TCP Server -> SCADA / PLC
                                         └─ REST API -> External systems
```

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (for production deployment)
- MQTT Broker (Mosquitto included in Docker setup)

### Development

1. **Install dependencies**
   ```bash
   cd server
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start MQTT broker** (if not running)
   ```bash
   docker run -d -p 1883:1883 -p 9001:9001 eclipse-mosquitto
   ```

4. **Run the server**
   ```bash
   npm run dev
   ```

5. **Open dashboard**
   Navigate to `http://localhost:3000`

### Production (Docker)

```bash
# Start all services
docker-compose up -d

# With Redis for horizontal scaling
docker-compose --profile with-redis up -d

# With Nginx reverse proxy
docker-compose --profile with-nginx up -d
```

## Project Structure

```
mqtt-server/
├── server/                     # Bridge Server (Node.js)
│   ├── src/
│   │   ├── api/               # REST API routes
│   │   ├── config/            # Configuration
│   │   ├── metrics/           # Prometheus metrics
│   │   ├── modbus/            # Modbus TCP server
│   │   ├── mqtt/              # MQTT client handler
│   │   ├── state/             # Board state management
│   │   ├── utils/             # Utilities (logger, etc.)
│   │   ├── websocket/         # Socket.io handler
│   │   └── server.js          # Main entry point
│   ├── Dockerfile
│   └── package.json
├── mqtt-dashboard/            # Web Dashboard
│   ├── css/style.css         # Baroque theme styles
│   ├── js/
│   │   ├── app.js            # Main application
│   │   ├── charts.js         # Chart.js configuration
│   │   └── onoff-control.js  # ON/OFF control module
│   └── index.html
├── docs/                      # Documentation
├── tests/                     # Unit & Integration tests
├── mosquitto/                 # MQTT broker config
├── docker-compose.yml
└── README.md
```

## API Reference

See [docs/api.md](docs/api.md) for complete API documentation.

### WebSocket Events

**Client → Server:**
- `join` - Join a board room: `{ boardId: "stm32-01" }`
- `leave` - Leave a board room
- `command` - Send command: `{ boardId, cmd, value, origin, reqId }`
- `getState` - Request current state
- `listBoards` - List all known boards

**Server → Client:**
- `state` - Full state update
- `telemetry` - Telemetry data
- `status` - Online/offline status change
- `command_ack` - Command acknowledgment
- `command_update` - Broadcast command update

### REST Endpoints

- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics
- `GET /api/boards` - List all boards
- `GET /api/state/:boardId` - Get board state
- `POST /api/command/:boardId` - Send command

## MQTT Topics

| Topic                      | Direction | Retained | Description                |
|---------------------------|-----------|----------|----------------------------|
| `stm32/<id>/state`        | Device→Broker | Yes  | Authoritative device state |
| `stm32/<id>/telemetry`    | Device→Broker | No   | Streaming sensor data      |
| `stm32/<id>/commands`     | Server→Device | No   | Control commands           |
| `stm32/<id>/status`       | LWT/Broker    | Yes  | Online/offline status      |

## Modbus Register Map

See [docs/modbus-map.md](docs/modbus-map.md) for complete register documentation.

| Register | Type | R/W | Description |
|----------|------|-----|-------------|
| 40001-40006 | HR | R | ADC channels 1-6 |
| 40010-40011 | HR | R/W | DAC channels 1-2 |
| 40020 | Coil | R/W | LED6 status |
| 40030 | HR | R | Temperature ×10 |
| 40031 | HR | R | Humidity ×10 |
| 40040 | HR | R/W | Latency (ms) |

## Testing

```bash
# Run unit tests
cd server
npm test

# Simulate telemetry
mosquitto_pub -t stm32/stm32-01/telemetry -m '{"adc":[100,200,300,400,500,600],"temp":25.5}'

# Simulate state
mosquitto_pub -t stm32/stm32-01/state -r -m '{"online":true,"dac":{"dac1":2048}}'
```

See [tests/README.md](tests/README.md) for complete testing documentation.

## License

MIT
