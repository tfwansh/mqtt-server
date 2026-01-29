import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
const mqttMessagesReceived = new client.Counter({
    name: 'stm32_bridge_mqtt_messages_received_total',
    help: 'Total number of MQTT messages received',
    labelNames: ['topic_type', 'board_id'],
});

const mqttMessagesPublished = new client.Counter({
    name: 'stm32_bridge_mqtt_messages_published_total',
    help: 'Total number of MQTT messages published',
    labelNames: ['board_id'],
});

const websocketConnections = new client.Gauge({
    name: 'stm32_bridge_websocket_connections',
    help: 'Current number of WebSocket connections',
});

const boardsOnline = new client.Gauge({
    name: 'stm32_bridge_boards_online',
    help: 'Number of boards currently online',
});

const commandsProcessed = new client.Counter({
    name: 'stm32_bridge_commands_processed_total',
    help: 'Total number of commands processed',
    labelNames: ['board_id', 'command', 'status'],
});

const modbusRequests = new client.Counter({
    name: 'stm32_bridge_modbus_requests_total',
    help: 'Total number of Modbus requests',
    labelNames: ['type', 'register'],
});

const lastTelemetryTimestamp = new client.Gauge({
    name: 'stm32_bridge_last_telemetry_timestamp',
    help: 'Timestamp of last telemetry received per board',
    labelNames: ['board_id'],
});

// Register custom metrics
register.registerMetric(mqttMessagesReceived);
register.registerMetric(mqttMessagesPublished);
register.registerMetric(websocketConnections);
register.registerMetric(boardsOnline);
register.registerMetric(commandsProcessed);
register.registerMetric(modbusRequests);
register.registerMetric(lastTelemetryTimestamp);

export const promClient = client;

export const metrics = {
    mqttMessagesReceived,
    mqttMessagesPublished,
    websocketConnections,
    boardsOnline,
    commandsProcessed,
    modbusRequests,
    lastTelemetryTimestamp,
};

export default { promClient, metrics };
