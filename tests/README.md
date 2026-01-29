# Testing Guide

## Overview

This directory contains unit tests, integration tests, and testing utilities for the STM32 Bridge Server.

## Test Structure

```
tests/
├── unit/                  # Unit tests
│   ├── BoardStateManager.test.js
│   └── onoff-algorithm.test.js
├── integration/           # Integration tests
│   └── mqtt-socket.test.js
├── fixtures/              # Test fixtures and mocks
│   └── telemetry.json
└── README.md
```

## Running Tests

### Unit Tests

```bash
cd server
npm test
```

### Watch Mode

```bash
npm run test:watch
```

### Integration Tests

Integration tests require running services:

```bash
# Start services
docker-compose up -d mosquitto

# Run integration tests
npm run test:integration
```

## Manual Testing

### Simulate Telemetry

```bash
# Single telemetry message
mosquitto_pub -h localhost -t stm32/stm32-01/telemetry -m \
  '{"board_id":"stm32-01","ts":1700000000000,"adc":[100,200,300,400,500,600],"temp":27.2,"humid":45}'

# Continuous telemetry (every second)
while true; do
  mosquitto_pub -h localhost -t stm32/stm32-01/telemetry -m \
    "{\"board_id\":\"stm32-01\",\"ts\":$(date +%s)000,\"adc\":[$(($RANDOM%4096)),$(($RANDOM%4096)),$(($RANDOM%4096)),$(($RANDOM%4096)),$(($RANDOM%4096)),$(($RANDOM%4096))],\"temp\":$((20+$RANDOM%15)).$((RANDOM%10)),\"humid\":$((30+$RANDOM%40))}"
  sleep 1
done
```

### Simulate State

```bash
# Publish retained state (board online)
mosquitto_pub -h localhost -t stm32/stm32-01/state -r -m \
  '{"board_id":"stm32-01","online":true,"ts":1700000000000,"dac":{"dac1":2048,"dac2":1024},"actuators":{"led6":false},"latency_ms":1000,"fw":"v1.2.3"}'

# Publish offline state
mosquitto_pub -h localhost -t stm32/stm32-01/state -r -m \
  '{"board_id":"stm32-01","online":false,"ts":1700000000000}'
```

### Simulate Commands

```bash
# Set DAC1
mosquitto_pub -h localhost -t stm32/stm32-01/commands -m \
  '{"cmd":"DAC1","value":2048,"origin":"test","reqId":"test-001","ts":1700000000000}'

# Toggle LED
mosquitto_pub -h localhost -t stm32/stm32-01/commands -m \
  '{"cmd":"LED6","value":true,"origin":"test","reqId":"test-002","ts":1700000000000}'
```

### Monitor Topics

```bash
# Monitor all STM32 topics
mosquitto_sub -h localhost -t 'stm32/#' -v

# Monitor specific board
mosquitto_sub -h localhost -t 'stm32/stm32-01/#' -v
```

### Test WebSocket

Using `wscat` or browser console:

```bash
# Install wscat
npm install -g wscat

# Connect (note: socket.io uses specific protocol)
# For raw testing, use the browser console instead
```

Browser console:
```javascript
const socket = io('http://localhost:3000', { path: '/ws' });
socket.on('connect', () => {
  console.log('Connected');
  socket.emit('join', { boardId: 'stm32-01' });
});
socket.on('state', (data) => console.log('State:', data));
socket.on('telemetry', (data) => console.log('Telemetry:', data));
```

### Test Modbus

Using Python pymodbus:

```python
from pymodbus.client import ModbusTcpClient

client = ModbusTcpClient('localhost', port=502)
client.connect()

# Read ADC values
result = client.read_holding_registers(0, 6, unit=1)
print(f"ADC: {result.registers}")

# Write DAC1
client.write_register(9, 2048, unit=1)
print("DAC1 set to 2048")

# Read back
result = client.read_holding_registers(9, 2, unit=1)
print(f"DAC: {result.registers}")

client.close()
```

### Test REST API

```bash
# Health check
curl http://localhost:3000/health

# Get state
curl http://localhost:3000/api/state/stm32-01

# Send command
curl -X POST http://localhost:3000/api/command/stm32-01 \
  -H "Content-Type: application/json" \
  -d '{"cmd":"DAC1","value":1234}'

# Get metrics
curl http://localhost:3000/metrics
```

## Load Testing

### Concurrent Clients

```bash
# Using artillery (install: npm install -g artillery)
artillery quick --count 100 --num 10 http://localhost:3000/health
```

### Message Throughput

```bash
# High-frequency telemetry
for i in {1..1000}; do
  mosquitto_pub -h localhost -t stm32/stm32-01/telemetry -m \
    "{\"board_id\":\"stm32-01\",\"ts\":$i,\"adc\":[1,2,3,4,5,6]}"
done
```

## Fault Testing

### Simulate Board Disconnect

1. Start publishing telemetry
2. Stop publishing
3. Wait for timeout (default 10s)
4. Verify server marks board offline
5. Verify clients receive status update

### Simulate MQTT Broker Restart

```bash
docker-compose restart mosquitto
# Verify bridge reconnects automatically
```

### Simulate Server Restart

```bash
docker-compose restart bridge
# Verify retained state is restored from MQTT
```

## Expected Behaviors

| Scenario | Expected Result |
|----------|-----------------|
| Board publishes telemetry | All clients receive update <1s |
| Client sends command | All clients see command_update |
| Board goes offline | Status shows OFFLINE |
| Board reconnects | Status shows ONLINE |
| Modbus write to DAC | MQTT command published |
| Server restart | State restored from retained MQTT |
