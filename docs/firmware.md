# Firmware Requirements

This document describes the MQTT communication requirements for STM32 firmware to integrate with the Bridge server.

## MQTT Connection

### Broker Connection

```c
// Example connection parameters
#define MQTT_BROKER_HOST    "192.168.1.100"
#define MQTT_BROKER_PORT    1883
#define MQTT_CLIENT_ID      "stm32-01"
#define MQTT_KEEP_ALIVE     60  // seconds
```

### Last Will and Testament (LWT)

**Critical:** Configure LWT for accurate offline detection.

```c
// LWT Configuration
#define LWT_TOPIC       "stm32/stm32-01/status"
#define LWT_PAYLOAD     "{\"online\":false,\"ts\":%lu}"
#define LWT_QOS         1
#define LWT_RETAIN      true
```

## Topics

### Publishing Topics

| Topic | QoS | Retain | Frequency | Description |
|-------|-----|--------|-----------|-------------|
| `stm32/<id>/state` | 1 | Yes | On change | Authoritative state |
| `stm32/<id>/telemetry` | 0 | No | Periodic (configurable) | Sensor data |
| `stm32/<id>/status` | 1 | Yes | On boot | Online status |

### Subscribe Topics

| Topic | QoS | Description |
|-------|-----|-------------|
| `stm32/<id>/commands` | 1 | Control commands from server |

## Message Schemas

### State Message (Retained)

Publish on boot and after any output change:

```json
{
  "board_id": "stm32-01",
  "online": true,
  "ts": 1700000000000,
  "uptime_ms": 1234567,
  "dac": {
    "dac1": 2048,
    "dac2": 1024
  },
  "actuators": {
    "led6": true
  },
  "latency_ms": 1000,
  "fw": "v1.2.3"
}
```

### Telemetry Message (Non-retained)

Publish periodically:

```json
{
  "board_id": "stm32-01",
  "ts": 1700000000000,
  "seq": 123,
  "adc": [1200, 2048, 4095, 0, 512, 1024],
  "temp": 27.6,
  "humid": 48.5,
  "press": 1008.2
}
```

### Command Message (Incoming)

```json
{
  "cmd": "DAC1",
  "value": 2048,
  "origin": "web:user",
  "reqId": "uuid-v4",
  "ts": 1700000000000
}
```

## Command Handling

### Supported Commands

| Command | Value Type | Range | Action |
|---------|-----------|-------|--------|
| `DAC1` | uint16 | 0-4095 | Set DAC1 output |
| `DAC2` | uint16 | 0-4095 | Set DAC2 output |
| `LED6` | bool/int | true/false, 0/1 | Toggle LED6 |
| `LATENCY` | uint16 | 100-60000 | Set telemetry interval (ms) |

### Command Processing Flow

```
1. Receive command on stm32/<id>/commands
2. Parse JSON
3. Validate command and value
4. Apply to hardware
5. Publish updated state to stm32/<id>/state (retained)
```

### Error Handling

If command fails, include error in state:

```json
{
  "board_id": "stm32-01",
  "online": true,
  "ts": 1700000000000,
  "last_error": "DAC1 value out of range",
  "dac": { "dac1": 0, "dac2": 0 }
}
```

## Implementation Example (Pseudocode)

```c
// On MQTT connect
void on_mqtt_connect() {
    // Subscribe to commands
    mqtt_subscribe("stm32/stm32-01/commands", QOS_1);
    
    // Publish online status
    publish_status(true);
    
    // Publish initial state
    publish_state();
}

// Telemetry timer callback
void telemetry_timer_callback() {
    char payload[256];
    snprintf(payload, sizeof(payload),
        "{\"board_id\":\"%s\",\"ts\":%lu,\"adc\":[%d,%d,%d,%d,%d,%d],\"temp\":%.1f,\"humid\":%.1f}",
        BOARD_ID, get_timestamp_ms(),
        adc_values[0], adc_values[1], adc_values[2],
        adc_values[3], adc_values[4], adc_values[5],
        temperature, humidity
    );
    
    mqtt_publish("stm32/stm32-01/telemetry", payload, QOS_0, false);
}

// Command handler
void on_command_received(const char* payload) {
    // Parse JSON
    cJSON* json = cJSON_Parse(payload);
    const char* cmd = cJSON_GetObjectItem(json, "cmd")->valuestring;
    int value = cJSON_GetObjectItem(json, "value")->valueint;
    
    if (strcmp(cmd, "DAC1") == 0) {
        HAL_DAC_SetValue(&hdac, DAC_CHANNEL_1, DAC_ALIGN_12B_R, value);
        dac_values.dac1 = value;
    } else if (strcmp(cmd, "DAC2") == 0) {
        HAL_DAC_SetValue(&hdac, DAC_CHANNEL_2, DAC_ALIGN_12B_R, value);
        dac_values.dac2 = value;
    } else if (strcmp(cmd, "LED6") == 0) {
        HAL_GPIO_WritePin(LED6_GPIO_Port, LED6_Pin, value ? GPIO_PIN_SET : GPIO_PIN_RESET);
        actuators.led6 = value;
    } else if (strcmp(cmd, "LATENCY") == 0) {
        telemetry_interval_ms = value;
        reconfigure_telemetry_timer(value);
    }
    
    cJSON_Delete(json);
    
    // Publish updated state
    publish_state();
}

void publish_state() {
    char payload[512];
    snprintf(payload, sizeof(payload),
        "{\"board_id\":\"%s\",\"online\":true,\"ts\":%lu,\"uptime_ms\":%lu,"
        "\"dac\":{\"dac1\":%d,\"dac2\":%d},"
        "\"actuators\":{\"led6\":%s},"
        "\"latency_ms\":%d,\"fw\":\"%s\"}",
        BOARD_ID, get_timestamp_ms(), HAL_GetTick(),
        dac_values.dac1, dac_values.dac2,
        actuators.led6 ? "true" : "false",
        telemetry_interval_ms, FIRMWARE_VERSION
    );
    
    mqtt_publish("stm32/stm32-01/state", payload, QOS_1, true);
}
```

## Timing Requirements

- **Telemetry interval:** Configurable, default 1000ms, minimum 100ms
- **State publish:** Immediately after any output change
- **Keep-alive:** 60 seconds recommended
- **Command response:** Apply and publish state within 100ms

## Offline Detection

The server marks a board offline if:
1. LWT message received (unclean disconnect), OR
2. No telemetry received for 10 seconds (configurable)

Ensure telemetry is published regularly even if values haven't changed.
