# Modbus TCP Register Map

The Bridge server exposes an authoritative Modbus TCP interface for SCADA/PLC integration.

**Default Port:** 502  
**Unit ID:** 1

## Holding Registers (Function Codes 3, 6, 16)

### ADC Channels (Read-Only)

| Register | Address | Type | Range | Description |
|----------|---------|------|-------|-------------|
| 40001 | 0 | uint16 | 0-4095 | ADC Channel 1 raw value |
| 40002 | 1 | uint16 | 0-4095 | ADC Channel 2 raw value |
| 40003 | 2 | uint16 | 0-4095 | ADC Channel 3 raw value |
| 40004 | 3 | uint16 | 0-4095 | ADC Channel 4 raw value |
| 40005 | 4 | uint16 | 0-4095 | ADC Channel 5 raw value |
| 40006 | 5 | uint16 | 0-4095 | ADC Channel 6 raw value |

### DAC Channels (Read/Write)

| Register | Address | Type | Range | Description |
|----------|---------|------|-------|-------------|
| 40010 | 9 | uint16 | 0-4095 | DAC Channel 1 output |
| 40011 | 10 | uint16 | 0-4095 | DAC Channel 2 output |

**Write behavior:** Writing to DAC registers sends a command to the STM32 via MQTT.

### Actuators (Read/Write)

| Register | Address | Type | Range | Description |
|----------|---------|------|-------|-------------|
| 40020 | 19 | uint16 | 0-1 | LED6 state (0=OFF, 1=ON) |

### Environment (Read-Only)

| Register | Address | Type | Range | Description |
|----------|---------|------|-------|-------------|
| 40030 | 29 | int16 | -400 to 850 | Temperature × 10 (e.g., 256 = 25.6°C) |
| 40031 | 30 | uint16 | 0-1000 | Humidity × 10 (e.g., 485 = 48.5%) |

### Configuration (Read/Write)

| Register | Address | Type | Range | Description |
|----------|---------|------|-------|-------------|
| 40040 | 39 | uint16 | 100-60000 | Telemetry latency in ms |

### Status (Read-Only)

| Register | Address | Type | Description |
|----------|---------|------|-------------|
| 40100 | 99 | uint16 | Status flags (bit-packed) |

**Status Flags (40100):**
- Bit 0: Online status (1 = online, 0 = offline)
- Bits 1-15: Reserved

## Coils (Function Codes 1, 5, 15)

| Coil | Address | R/W | Description |
|------|---------|-----|-------------|
| 00001 | 0 | R/W | LED6 state |

## Scaling

### Temperature
```
actual_temp = register_value / 10.0
```
Example: Register value 276 = 27.6°C

### Humidity
```
actual_humid = register_value / 10.0
```
Example: Register value 485 = 48.5%

### ADC to Voltage (3.3V reference)
```
voltage = (register_value / 4095.0) * 3.3
```

### ADC to Percentage
```
percent = (register_value / 4095.0) * 100
```

## Example Usage

### Python (pymodbus)

```python
from pymodbus.client import ModbusTcpClient

client = ModbusTcpClient('localhost', port=502)
client.connect()

# Read ADC channels
result = client.read_holding_registers(0, 6, unit=1)
adc_values = result.registers
print(f"ADC values: {adc_values}")

# Read temperature
result = client.read_holding_registers(29, 1, unit=1)
temp = result.registers[0] / 10.0
print(f"Temperature: {temp}°C")

# Write DAC1
client.write_register(9, 2048, unit=1)
print("DAC1 set to 2048")

# Toggle LED
client.write_coil(0, True, unit=1)
print("LED6 ON")

client.close()
```

### Node-RED

Use the `node-red-contrib-modbus` package:

1. Add a "Modbus Read" node
2. Configure:
   - Server: `localhost:502`
   - Unit ID: 1
   - FC: 3 (Read Holding Registers)
   - Address: 0
   - Quantity: 6

### SCADA Integration

Most SCADA systems (Ignition, Wonderware, etc.) can connect using:
- Protocol: Modbus TCP
- IP: Bridge server IP
- Port: 502
- Slave/Unit ID: 1

## Security Considerations

⚠️ **Warning:** Modbus TCP has no built-in authentication.

Recommended security measures:
1. Restrict access via firewall/IP whitelist
2. Use VPN for remote access
3. Place Modbus server on isolated network segment
4. Monitor for anomalous traffic

## Error Handling

The Modbus server returns appropriate exception codes:
- **0x02 (Illegal Data Address):** Register address out of range
- **0x03 (Illegal Data Value):** Write value out of valid range
- **0x04 (Slave Device Failure):** MQTT publish failed
