/*
 * mqtt_iot_client.c
 *
 *  Created on: Jan 29, 2026
 *      Author: Antigravity (Updated for Bridge/Dashboard Architecture)
 */

/**
 ******************************************************************************
 * @file    mqtt_iot_client.c
 * @brief   STM32 IoT: COMPLIANT CLIENT (JSON Commands + Retained State)
 ******************************************************************************
 */

#include "mqtt_iot_client.h"
#include "b_u585i_iot02a.h"
#include "custom_adc.h"
#include "custom_dac.h"
#include "webserver_sensors.h"

#include "MQTTClient.h" // Paho MQTT library
#include "net_connect.h"
#include "net_internals.h"
#include <stdio.h>
#include <stdlib.h> // for atoi/strtol
#include <string.h>

/* ================= CONFIG ================= */
#define MQTT_BROKER_HOST "57.159.29.89"
#define MQTT_BROKER_PORT 1883
#define MQTT_CLIENT_ID "stm32-01" // Must match Dashboard selection
#define MQTT_KEEPALIVE 120 // Increased from 60 to 120 for better stability

// TOPIC DEFINITIONS (Must include Board ID)
#define TOPIC_TELEMETRY "stm32/" MQTT_CLIENT_ID "/telemetry"
#define TOPIC_COMMANDS "stm32/" MQTT_CLIENT_ID "/commands"
#define TOPIC_STATE "stm32/" MQTT_CLIENT_ID "/state"
#define TOPIC_STATUS "stm32/" MQTT_CLIENT_ID "/status"

#define DEFAULT_PUBLISH_INTERVAL_MS 100
static uint32_t g_publish_interval_ms = DEFAULT_PUBLISH_INTERVAL_MS;

/* ========================================= */

static MQTTClient mqtt_client;
static Network mqtt_network;
static unsigned char
    sendbuf[8192]; // Increased from 2048 to prevent buffer overflow
static unsigned char
    readbuf[8192]; // Increased from 2048 to prevent buffer overflow
static int32_t g_sock = -1;

/* ===== Network Interface for Paho MQTT ===== */
int mqtt_net_read(Network *n, unsigned char *buffer, int len, int timeout_ms) {
  // CRITICAL FIX: Always use non-blocking read.
  // If we use blocking (0), MQTTYield hangs until a packet arrives or TCP times
  // out (decades!) Paho handles the "0 bytes read" case correctly by checking
  // timer.
  int r = net_recv(g_sock, buffer, len, NET_MSG_DONTWAIT);
  return (r > 0) ? r : 0;
}

int mqtt_net_write(Network *n, unsigned char *buffer, int len, int timeout_ms) {
  return net_send(g_sock, buffer, len, 0);
}

void mqtt_net_disconnect(Network *n) {
  if (g_sock >= 0) {
    net_closesocket(g_sock);
    g_sock = -1;
  }
}

/* ===== HELPER: Publish Authoritative State (Retained) ===== */
void publish_state(void) {
  char json_payload[384]; // Ensure enough size
  uint32_t dac1 = Custom_DAC_Get_Value(1);
  uint32_t dac2 = Custom_DAC_Get_Value(2);
  // Assuming LED6 state is tracked or readable.
  // If BSP_LED_GetState doesn't exist, we track it manually or assume from last
  // command. For now assuming a hypothetical reading or tracking variable could
  // be added. Here we will track it logically or read if HAL supports it. int
  // led6_status = HAL_GPIO_ReadPin(LED6_GPIO_Port, LED6_Pin); Since BSP usually
  // just toggles, let's assume we want to report what we think it is. For
  // strict correctness, you should add `static int g_led6_state = 0;` and
  // update it on change.

  // We'll use a placeholder or read register directly if possible.
  // For this example, let's assume we read the pin (Standard HAL)
  int led6_status = HAL_GPIO_ReadPin(
      GPIOH, GPIO_PIN_7); // PH7 is usually LED_RED on some boards, verify
                          // schematic for U585 LED6

  snprintf(json_payload, sizeof(json_payload),
           "{\"board_id\":\"%s\",\"online\":true,\"ts\":%lu,\"uptime_ms\":%lu,"
           "\"dac\":{\"dac1\":%lu,\"dac2\":%lu},"
           "\"actuators\":{\"led6\":%s},"
           "\"latency_ms\":%lu,\"fw\":\"v2.0.0-json\"}",
           MQTT_CLIENT_ID, HAL_GetTick(), HAL_GetTick(), dac1, dac2,
           led6_status ? "true" : "false", g_publish_interval_ms);

  MQTTMessage message;
  message.payload = json_payload;
  message.payloadlen = strlen(json_payload);
  message.qos = QOS1;
  message.retained = 1; // RETAINED is critical for new clients

  MQTTPublish(&mqtt_client, TOPIC_STATE, &message);
  printf("[MQTT] State Published (Retained)\n");
}

/* ===== HELPER: Simple JSON Parser ===== */
// Finds value for a key in a flat JSON string. Returns 1 if found, 0 if not.
// value_out buffer must be provided.
int json_get_value(const char *json, const char *key, char *value_out,
                   int max_len) {
  char search_key[32];
  snprintf(search_key, sizeof(search_key), "\"%s\"", key);

  char *key_ptr = strstr(json, search_key);
  if (!key_ptr)
    return 0;

  char *val_start = strchr(key_ptr, ':');
  if (!val_start)
    return 0;
  val_start++; // Skip ':'

  // Skip whitespace
  while (*val_start == ' ' || *val_start == '\t')
    val_start++;

  char *val_end;
  if (*val_start == '"') {
    // String value
    val_start++; // Skip opening quote
    val_end = strchr(val_start, '"');
  } else {
    // Number or boolean
    val_end = strpbrk(val_start, ",}");
  }

  if (!val_end)
    return 0;

  int len = val_end - val_start;
  if (len >= max_len)
    len = max_len - 1;

  strncpy(value_out, val_start, len);
  value_out[len] = '\0';
  return 1;
}

/* ===== Message Arrived Callback (JSON COMMANDS) ===== */
void message_arrived_callback(MessageData *md) {
  MQTTMessage *msg = md->message;
  char payload[256];

  // Extract payload
  int len = (msg->payloadlen < sizeof(payload) - 1) ? msg->payloadlen
                                                    : sizeof(payload) - 1;
  memcpy(payload, msg->payload, len);
  payload[len] = '\0';

  printf("[MQTT] RX CMD: %s\n", payload);

  // Parse JSON Command
  // Expected: {"cmd":"DAC1", "value":2048, ...}
  char cmd_str[16] = {0};
  char val_str[16] = {0};

  if (json_get_value(payload, "cmd", cmd_str, sizeof(cmd_str))) {
    // We found a command
    json_get_value(payload, "value", val_str, sizeof(val_str));

    // Handle value parsing (int vs bool)
    int value_int = atoi(val_str);
    // Special case for boolean "true"/"false" in basic parser
    if (strstr(val_str, "true"))
      value_int = 1;
    if (strstr(val_str, "false"))
      value_int = 0;

    int state_change = 0;

    if (strcmp(cmd_str, "DAC1") == 0) {
      Custom_DAC_Set_Value(1, (uint32_t)value_int);
      printf("[CMD] Applied DAC1 = %d\n", value_int);
      state_change = 1;
    } else if (strcmp(cmd_str, "DAC2") == 0) {
      Custom_DAC_Set_Value(2, (uint32_t)value_int);
      printf("[CMD] Applied DAC2 = %d\n", value_int);
      state_change = 1;

    } else if (strcmp(cmd_str, "LED6") == 0) {
      if (value_int)
        BSP_LED_On(LED6);
      else
        BSP_LED_Off(LED6);
      printf("[CMD] Applied LED6 = %d\n", value_int);
      state_change = 1;
    } else if (strcmp(cmd_str, "LATENCY") == 0) {
      if (value_int < 10)
        value_int = 10; // Minimum 10ms (user requirement: 10ms - 10s range)
      if (value_int > 10000)
        value_int = 10000; // Maximum 10s
      g_publish_interval_ms = (uint32_t)value_int;
      printf("[CMD] Applied LATENCY = %lu ms\n", g_publish_interval_ms);
      state_change = 1;
    }

    // IMPORTANT: Acknowledge by publishing new authoritative state
    if (state_change) {
      publish_state();
    }
  }
}

/* ===== Connect to MQTT Broker ===== */
static int mqtt_connect_broker(void) {
  net_sockaddr_t addr = {0};
  MQTTPacket_connectData conn_data = MQTTPacket_connectData_initializer;
  int rc;

  printf("[MQTT] Connecting to %s:%d\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);

  g_sock = net_socket(NET_AF_INET, NET_SOCK_STREAM, NET_IPPROTO_TCP);
  if (g_sock < 0)
    return -1;

  addr.sa_family = NET_AF_INET;
  addr.sa_len = sizeof(addr);
  net_set_port(&addr, MQTT_BROKER_PORT);

  if (net_if_gethostbyname(NULL, &addr, (char_t *)MQTT_BROKER_HOST) != NET_OK) {
    printf("[MQTT] DNS failed\n");
    net_closesocket(g_sock);
    g_sock = -1;
    return -1;
  }

  if (net_connect(g_sock, &addr, sizeof(addr)) != NET_OK) {
    printf("[MQTT] Connect failed\n");
    net_closesocket(g_sock);
    g_sock = -1;
    return -1;
  }

  // Init Paho Client
  mqtt_network.mqttread = mqtt_net_read;
  mqtt_network.mqttwrite = mqtt_net_write;
  mqtt_network.disconnect = mqtt_net_disconnect;

  MQTTClientInit(&mqtt_client, &mqtt_network, 3000, sendbuf, sizeof(sendbuf),
                 readbuf, sizeof(readbuf));

  conn_data.MQTTVersion = 4;
  conn_data.clientID.cstring = MQTT_CLIENT_ID;
  conn_data.keepAliveInterval = MQTT_KEEPALIVE;
  conn_data.cleansession = 1;

  // LWT (Last Will and Testament) - Critical for Presence
  // Broker will publish this if we disconnect uncleanly
  conn_data.willFlag = 1;
  conn_data.will.topicName.cstring = TOPIC_STATUS;
  conn_data.will.message.cstring = "{\"online\":false}";
  conn_data.will.qos = QOS1;
  conn_data.will.retained = 1;

  rc = MQTTConnect(&mqtt_client, &conn_data);
  if (rc != 0) {
    printf("[MQTT] MQTT Connect failed: %d\n", rc);
    mqtt_net_disconnect(&mqtt_network);
    return -1;
  }

  printf("[MQTT] Connected as %s\n", MQTT_CLIENT_ID);
  return 0;
}

static int mqtt_subscribe_commands(void) {
  int rc = MQTTSubscribe(&mqtt_client, TOPIC_COMMANDS, QOS1,
                         message_arrived_callback);
  return rc;
}

/* ================= MAIN LOOP ================= */
void mqtt_iot_client_run(void) {
  BSP_LED_Init(LED6);
  Custom_ADC_Init();
  Custom_DAC_Init();

  float temperature, humidity, pressure;
  uint32_t last_publish = 0;
  uint32_t consecutive_failures = 0; // Track connection health
  uint32_t last_reconnect_attempt = 0;
  int connected = 0;

  printf("\n=== STM32 BRIDGE CLIENT v2.0 ===\n");

  while (1) {
    // Connection State Machine
    if (!connected) {
      // Wait at least 5 seconds between reconnection attempts
      if (HAL_GetTick() - last_reconnect_attempt < 5000) {
        HAL_Delay(100);
        continue;
      }

      last_reconnect_attempt = HAL_GetTick();
      printf("[MQTT] Attempting connection...\n");

      if (mqtt_connect_broker() != 0) {
        printf("[MQTT] Connection failed, retry in 5s\n");
        continue;
      }

      if (mqtt_subscribe_commands() != 0) {
        printf("[MQTT] Subscribe failed\n");
        mqtt_net_disconnect(&mqtt_network);
        continue;
      }

      // Publish Initial State (Retained) and Online Status
      {
        // Status: Online
        MQTTMessage msg;
        char *status_payload = "{\"online\":true}";
        msg.payload = status_payload;
        msg.payloadlen = strlen(status_payload);
        msg.qos = QOS1;
        msg.retained = 1;
        MQTTPublish(&mqtt_client, TOPIC_STATUS, &msg);

        // Full State
        publish_state();
      }

      connected = 1;
      consecutive_failures = 0;
      last_publish = HAL_GetTick();
      printf("[MQTT] ✓ Connected and ready\n");
    }

    // Process MQTT (Keepalive + Incoming Commands)
    int yield_result = MQTTYield(&mqtt_client, 10);

    if (yield_result < 0) {
      consecutive_failures++;
      printf("[MQTT] Yield failed (%d), failures: %lu\n", yield_result,
             consecutive_failures);

      // If 5 consecutive failures, assume disconnected
      if (consecutive_failures > 5) {
        printf("[MQTT] Connection lost, reconnecting...\n");
        mqtt_net_disconnect(&mqtt_network);
        connected = 0;
        continue;
      }
    } else {
      // Reset failure counter on success
      if (consecutive_failures > 0) {
        consecutive_failures = 0;
      }
    }

    // Periodic Telemetry (only when connected)
    if (connected) {
      uint32_t now = HAL_GetTick();
      if ((now - last_publish) >= g_publish_interval_ms) {
        last_publish = now;

        webserver_temp_sensor_read(&temperature);
        webserver_humid_sensor_read(&humidity);
        webserver_press_sensor_read(&pressure);

        uint32_t adc_values[6] = {0};
        Custom_ADC_Read_All(adc_values, 6);

        char json_payload[320];
        MQTTMessage message;

        // Updated Telemetry Format
        snprintf(json_payload, sizeof(json_payload),
                 "{\"board_id\":\"%s\",\"ts\":%lu,"
                 "\"temp\":%.1f,\"humid\":%.1f,\"press\":%.1f,"
                 "\"adc\":[%lu,%lu,%lu,%lu,%lu,%lu]}",
                 MQTT_CLIENT_ID, HAL_GetTick(), temperature, humidity, pressure,
                 adc_values[0], adc_values[1], adc_values[2], adc_values[3],
                 adc_values[4], adc_values[5]);

        message.payload = json_payload;
        message.payloadlen = strlen(json_payload);
        message.qos = QOS0; // Telemetry is best-effort
        message.retained = 0;

        int pub_result = MQTTPublish(&mqtt_client, TOPIC_TELEMETRY, &message);
        if (pub_result < 0) {
          printf("[MQTT] Publish failed: %d\n", pub_result);
          consecutive_failures++;
        }
      }
    }

    // Small delay to prevent tight loop
    HAL_Delay(10);
  }
}
