/**
 * STM32 Dashboard - Main Application
 * Socket.io client with state management
 */

import { initCharts, updateCharts, updateEnvChart } from './charts.js';
import { initOnOffControl, updateOnOffControl } from './onoff-control.js';

// Configuration
const CONFIG = {
    BOARD_ID: 'stm32-01',
    RECONNECT_DELAY: 3000,
    TOAST_DURATION: 4000,
};

// Application State
const state = {
    socket: null,
    connected: false,
    boardId: CONFIG.BOARD_ID,
    online: false,
    lastState: null,
    lastTelemetry: null,
    lastCmd: null,
    msgCount: 0,
    msgRate: 0,
    chartsPaused: false,
};

// DOM Elements
const elements = {
    connectionStatus: document.getElementById('connection-status'),
    timestamp: document.getElementById('timestamp'),
    boardSelect: document.getElementById('board-select'),
    msgRate: document.getElementById('msg-rate'),
    adcGrid: document.getElementById('adc-grid'),
    chartsGrid: document.getElementById('charts-grid'),
    dacControls: document.getElementById('dac-controls'),
    actuatorGrid: document.getElementById('actuator-grid'),
    toastContainer: document.getElementById('toast-container'),
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    initializeSocket();
    initCharts();
    initOnOffControl(sendCommand);
    startTimers();
});

/**
 * Initialize UI components
 */
function initializeUI() {
    // Generate ADC grid items
    elements.adcGrid.innerHTML = Array.from({ length: 6 }, (_, i) => `
    <div class="adc-item" id="adc-item-${i + 1}">
      <div class="adc-label">ADC${i + 1}</div>
      <div class="adc-value" id="adc-value-${i + 1}">----</div>
      <div class="adc-bar"><div class="adc-bar-fill" id="adc-bar-${i + 1}"></div></div>
      <div class="adc-percent" id="adc-percent-${i + 1}">--%</div>
    </div>
  `).join('');

    // Generate DAC controls
    elements.dacControls.innerHTML = [1, 2].map(i => `
    <div class="dac-control" id="dac${i}-control">
      <div class="dac-header">
        <span class="dac-label">DAC${i}</span>
        <span class="dac-value-display" id="dac${i}-value">0</span>
      </div>
      <div class="dac-slider-container">
        <input type="range" class="dac-slider" id="dac${i}-slider" min="0" max="16383" value="0">
        <div class="dac-scale"><span>16383</span><span>8192</span><span>0</span></div>
      </div>
      <div class="dac-voltage" id="dac${i}-voltage">0.00 V</div>
      <button class="dac-apply-btn" id="btn-apply-dac${i}">APPLY</button>
    </div>
  `).join('');

    // Generate actuator controls
    elements.actuatorGrid.innerHTML = `
    <div class="actuator-item" id="led6-control">
      <div class="actuator-label">LED6</div>
      <button class="led-button" id="btn-led6" data-state="off">
        <div class="led-indicator"></div>
      </button>
      <div class="actuator-status" id="led6-status">OFF</div>
    </div>
  `;

    // Set up event listeners
    setupEventListeners();

    // Tab navigation
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

/**
 * Set up event listeners for controls
 */
function setupEventListeners() {
    // DAC sliders
    [1, 2].forEach(i => {
        const slider = document.getElementById(`dac${i}-slider`);
        const valueDisplay = document.getElementById(`dac${i}-value`);
        const voltageDisplay = document.getElementById(`dac${i}-voltage`);
        const applyBtn = document.getElementById(`btn-apply-dac${i}`);

        slider.addEventListener('input', () => {
            const value = parseInt(slider.value);
            valueDisplay.textContent = value;
            voltageDisplay.textContent = ((value / 16383) * 3.3).toFixed(2) + ' V';
        });

        applyBtn.addEventListener('click', () => {
            sendCommand(`DAC${i}`, parseInt(slider.value));
        });
    });

    // LED button
    const ledBtn = document.getElementById('btn-led6');
    ledBtn.addEventListener('click', () => {
        const currentState = ledBtn.dataset.state === 'on';
        sendCommand('LED6', !currentState);
    });

    // Latency control
    const latencySlider = document.getElementById('latency-slider');
    const latencyDisplay = document.getElementById('latency-display');
    const latencyApplyBtn = document.getElementById('btn-apply-latency');

    latencySlider.addEventListener('input', () => {
        latencyDisplay.textContent = latencySlider.value;
    });

    latencyApplyBtn.addEventListener('click', () => {
        sendCommand('LATENCY', parseInt(latencySlider.value));
    });

    // Board selector
    elements.boardSelect.addEventListener('change', (e) => {
        state.boardId = e.target.value;
        if (state.socket && state.connected) {
            state.socket.emit('leave', { boardId: state.boardId });
            state.socket.emit('join', { boardId: state.boardId });
        }
    });
}

/**
 * Initialize Socket.io connection
 */
function initializeSocket() {
    const socketUrl = window.location.origin;
    state.socket = io(socketUrl, {
        path: '/ws',
        reconnection: true,
        reconnectionDelay: CONFIG.RECONNECT_DELAY,
        reconnectionAttempts: Infinity,
    });

    state.socket.on('connect', () => {
        state.connected = true;
        updateConnectionStatus('connected');
        state.socket.emit('join', { boardId: state.boardId });
        showToast('Connected to server', 'success');
    });

    state.socket.on('disconnect', () => {
        state.connected = false;
        updateConnectionStatus('disconnected');
        showToast('Disconnected from server', 'error');
    });

    state.socket.on('state', handleState);
    state.socket.on('telemetry', handleTelemetry);
    state.socket.on('status', handleStatus);
    state.socket.on('command_ack', handleCommandAck);
    state.socket.on('command_update', handleCommandUpdate);
    state.socket.on('error', (error) => {
        console.error('[DASHBOARD] Socket error:', error);
        handleError(error);
    });
}

/**
 * Handle state update from server
 */
function handleState(data) {
    state.online = data.online;
    state.lastState = data.lastState;
    state.lastTelemetry = data.lastTelemetry;
    state.lastCmd = data.lastCmd;

    updateBoardStatus(data.online);

    if (data.lastState) {
        updateStateUI(data.lastState);
    }

    if (data.lastTelemetry) {
        updateTelemetryUI(data.lastTelemetry);
    }
}

/**
 * Handle telemetry update
 */
function handleTelemetry({ telemetry }) {
    state.lastTelemetry = telemetry;
    state.msgCount++;

    updateTelemetryUI(telemetry);

    if (!state.chartsPaused) {
        updateCharts(telemetry);
        updateEnvChart(telemetry);
    }

    updateOnOffControl(telemetry);
}

/**
 * Handle status change
 */
function handleStatus({ online, reason }) {
    state.online = online;
    updateBoardStatus(online);

    if (!online) {
        showToast(`Board offline: ${reason || 'unknown'}`, 'warning');
    } else {
        showToast('Board online', 'success');
    }
}

/**
 * Handle command acknowledgment
 */
function handleCommandAck({ reqId, ok, error }) {
    if (ok) {
        showToast('Command sent successfully', 'success');
    } else {
        showToast(`Command failed: ${error || 'unknown'}`, 'error');
    }
}

/**
 * Handle command update broadcast
 */
function handleCommandUpdate({ lastCmd }) {
    state.lastCmd = lastCmd;

    const statLastCmd = document.getElementById('stat-last-cmd');
    if (statLastCmd && lastCmd) {
        statLastCmd.textContent = `${lastCmd.cmd}: ${lastCmd.value}`;
    }
}

/**
 * Handle server error
 */
function handleError(error) {
    showToast(`Error: ${error.message || error}`, 'error');
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
    const indicator = elements.connectionStatus;
    indicator.className = `status-indicator ${status}`;
    indicator.querySelector('.status-text').textContent = status.toUpperCase();
}

/**
 * Update board online/offline status
 */
function updateBoardStatus(online) {
    const indicator = elements.connectionStatus;
    if (state.connected) {
        if (online) {
            indicator.className = 'status-indicator connected';
            indicator.querySelector('.status-text').textContent = 'ONLINE';
        } else {
            indicator.className = 'status-indicator disconnected';
            indicator.querySelector('.status-text').textContent = 'BOARD OFFLINE';
        }
    }
}

/**
 * Update UI with state data
 */
function updateStateUI(stateData) {
    // Update DAC values
    if (stateData.dac) {
        ['dac1', 'dac2'].forEach((key, i) => {
            const value = stateData.dac[key] || 0;
            document.getElementById(`dac${i + 1}-slider`).value = value;
            document.getElementById(`dac${i + 1}-value`).textContent = value;
            document.getElementById(`dac${i + 1}-voltage`).textContent =
                ((value / 16383) * 3.3).toFixed(2) + ' V';
        });
    }

    // Update actuators
    if (stateData.actuators) {
        const led6State = stateData.actuators.led6;
        const ledBtn = document.getElementById('btn-led6');
        const ledStatus = document.getElementById('led6-status');

        if (ledBtn) {
            ledBtn.dataset.state = led6State ? 'on' : 'off';
            ledStatus.textContent = led6State ? 'ON' : 'OFF';
        }
    }

    // Update system stats
    const statBoardId = document.getElementById('stat-board-id');
    const statFirmware = document.getElementById('stat-firmware');
    const statLatency = document.getElementById('stat-latency');

    if (statBoardId) statBoardId.textContent = stateData.board_id || '--';
    if (statFirmware) statFirmware.textContent = stateData.fw || '--';
    if (statLatency) statLatency.textContent = (stateData.latency_ms || '--') + ' ms';

    // Update latency slider
    if (stateData.latency_ms) {
        document.getElementById('latency-slider').value = stateData.latency_ms;
        document.getElementById('latency-display').textContent = stateData.latency_ms;
    }
}

/**
 * Update UI with telemetry data
 */
function updateTelemetryUI(telemetry) {
    // Update ADC values
    if (telemetry.adc) {
        telemetry.adc.forEach((value, i) => {
            const percent = ((value / 16383) * 100).toFixed(1);
            document.getElementById(`adc-value-${i + 1}`).textContent = value;
            document.getElementById(`adc-bar-${i + 1}`).style.width = percent + '%';
            document.getElementById(`adc-percent-${i + 1}`).textContent = percent + '%';
        });
    }

    // Update environment
    if (telemetry.temp !== undefined) {
        document.getElementById('temp-value').textContent = telemetry.temp.toFixed(1);
    }
    if (telemetry.humid !== undefined) {
        document.getElementById('humid-value').textContent = Math.round(telemetry.humid);
    }
    if (telemetry.press !== undefined) {
        document.getElementById('press-value').textContent = Math.round(telemetry.press);
    }
}

/**
 * Generate a simple UUID (works in non-HTTPS contexts)
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Send command to board via WebSocket
 */
export function sendCommand(cmd, value, origin = 'web') {
    console.log(`[DASHBOARD] sendCommand called: cmd=${cmd}, value=${value}, origin=${origin}`);
    console.log(`[DASHBOARD] Connection state: socket=${!!state.socket}, connected=${state.connected}`);

    if (!state.socket || !state.connected) {
        console.error('[DASHBOARD] Cannot send command: Not connected to server');
        showToast('Not connected to server', 'error');
        return;
    }

    const reqId = generateUUID(); // Use fallback instead of crypto.randomUUID for HTTP compatibility
    const commandPayload = {
        boardId: state.boardId,
        cmd,
        value,
        origin,
        reqId,
    };

    console.log(`[DASHBOARD] Emitting command:`, commandPayload);
    state.socket.emit('command', commandPayload);
    console.log(`[DASHBOARD] Command emitted successfully`);
}

/**
 * Switch between tabs
 */
function switchTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, CONFIG.TOAST_DURATION);
}

/**
 * Start periodic timers
 */
function startTimers() {
    // Update timestamp
    setInterval(() => {
        const now = new Date();
        elements.timestamp.textContent = now.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }, 1000);

    // Calculate message rate
    setInterval(() => {
        state.msgRate = state.msgCount;
        state.msgCount = 0;
        elements.msgRate.textContent = state.msgRate;
    }, 1000);
}

// Export for other modules
export { state, showToast };
