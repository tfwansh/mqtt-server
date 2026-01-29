/**
 * STM32 Dashboard - ON/OFF Control Module
 * Hysteresis-based ON/OFF control with PV/Setpoint/Output calculation
 */

// Module state
let sendCommandFn = null;
let previousOutput = 0;
let selectedAdc = 0;
let selectedDac = 'DAC1';
let autoMode = false;
let lastPv = 0;
let chart = null;
const chartData = {
  labels: [],
  datasets: [
    {
      label: 'Setpoint',
      data: [],
      borderColor: '#c5a059',
      borderDash: [5, 5],
      borderWidth: 2,
      pointRadius: 0,
      fill: false
    },
    {
      label: 'Process Value (ADC)',
      data: [],
      borderColor: '#3fcf8e',
      borderWidth: 2,
      pointRadius: 0,
      fill: false
    },
    {
      label: 'Output (DAC)',
      data: [],
      borderColor: '#3f8fcf',
      borderWidth: 2,
      pointRadius: 0,
      fill: true,
      backgroundColor: 'rgba(63, 143, 207, 0.2)'
    }
  ]
};

// DOM elements cache
const elems = {};

/**
 * Initialize ON/OFF control module
 */
export function initOnOffControl(sendCommand) {
  sendCommandFn = sendCommand;
  cacheElements();
  generateUI();
  setupEventListeners();
}

/**
 * Cache DOM element references
 */
function cacheElements() {
  elems.container = document.getElementById('onoff-container');
}

/**
 * Generate ON/OFF control UI
 */
function generateUI() {
  if (!elems.container) return;

  elems.container.innerHTML = `
    <!-- Input Selection -->
    <div class="onoff-section">
      <div class="section-title">PROCESS INPUT</div>
      <div class="radio-group" id="adc-selector">
        ${[1, 2, 3, 4, 5, 6].map(i => `
          <div class="radio-item ${i === 1 ? 'active' : ''}" data-adc="${i - 1}">
            <input type="radio" name="adc-select" id="adc-radio-${i}" ${i === 1 ? 'checked' : ''}>
            <label class="radio-label" for="adc-radio-${i}">ADC${i}</label>
          </div>
        `).join('')}
      </div>
      <div class="pv-display">
        <div class="pv-label">PROCESS VALUE (PV)</div>
        <div class="pv-cage">
          <span class="pv-value" id="onoff-pv">--.-</span>
          <span class="pv-unit">%</span>
        </div>
        <div class="pv-raw">RAW: <span id="onoff-pv-raw">----</span> / 16383</div>
      </div>
    </div>

    <!-- Setpoint & Hysteresis -->
    <div class="onoff-section">
      <div class="section-title">SETPOINT & HYSTERESIS</div>
      <div class="control-inputs">
        <div class="control-input-group">
          <label for="setpoint-input">SETPOINT (%)</label>
          <div class="input-cage">
            <input type="number" id="setpoint-input" min="0" max="100" value="50" step="0.1">
          </div>
        </div>
        <div class="control-input-group">
          <label for="hysteresis-input">HYSTERESIS (%)</label>
          <div class="input-cage">
            <input type="number" id="hysteresis-input" min="0" max="50" value="5" step="0.1">
          </div>
        </div>
      </div>
      <div class="threshold-display">
        <div class="threshold-item">
          <span class="threshold-label">HIGH</span>
          <span class="threshold-value" id="threshold-high">52.5%</span>
        </div>
        <div class="threshold-item">
          <span class="threshold-label">SP</span>
          <span class="threshold-value sp" id="threshold-sp">50.0%</span>
        </div>
        <div class="threshold-item">
          <span class="threshold-label">LOW</span>
          <span class="threshold-value" id="threshold-low">47.5%</span>
        </div>
      </div>
    </div>

    <!-- Output Configuration -->
    <div class="onoff-section">
      <div class="section-title">OUTPUT CONFIGURATION</div>
      <div class="dac-selector">
        <button class="dac-btn active" data-dac="DAC1" id="dac-btn-1">DAC1</button>
        <button class="dac-btn" data-dac="DAC2" id="dac-btn-2">DAC2</button>
      </div>
      <div class="output-display">
        <div class="output-label">COMPUTED OUTPUT</div>
        <div class="output-cage">
          <span class="output-value" id="onoff-output">--</span>
          <span class="output-unit">%</span>
        </div>
        <div class="output-dac">DAC VALUE: <span id="onoff-dac-value">----</span></div>
      </div>
    </div>

    <!-- Control Actions -->
    <div class="onoff-section actions-section">
      <div class="mode-toggle">
        <label class="toggle-label">
          <input type="checkbox" id="auto-mode-toggle">
          <span class="toggle-slider"></span>
          <span class="toggle-text">AUTO MODE</span>
        </label>
      </div>
      <button class="action-button primary" id="btn-apply-onoff">APPLY OUTPUT</button>
    </div>

    <!-- Visual Indicator -->
    <div class="onoff-section">
      <div class="section-title">PROCESS VISUALIZER</div>
      <div class="onoff-visualizer">
        <div class="visualizer-bar">
          <div class="visualizer-fill" id="pv-visualizer"></div>
          <div class="visualizer-marker sp" id="sp-marker" style="left: 50%"></div>
          <div class="visualizer-marker high" id="high-marker" style="left: 52.5%"></div>
          <div class="visualizer-marker low" id="low-marker" style="left: 47.5%"></div>
          <div class="visualizer-pointer" id="pv-pointer" style="left: 0%"></div>
        </div>
        <div class="visualizer-labels">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>
    </div>

    <!-- Time-Series Graph -->
    <div class="onoff-section">
      <div class="section-title">CONTROL HISTORY</div>
      <div style="position: relative; height: 250px;">
        <canvas id="onoff-chart"></canvas>
      </div>
    </div>

    <!-- Time-Series Graph -->
    <div class="onoff-section">
      <div class="section-title">CONTROL HISTORY</div>
      <div style="position: relative; height: 250px;">
        <canvas id="onoff-chart"></canvas>
      </div>
    </div>

    <!-- Control Log -->
    <div class="onoff-section">
      <div class="section-title">CONTROL LOG</div>
      <div class="control-log" id="control-log"></div>
    </div>
  `;

  // Add visualizer styles
  addVisualizerStyles();

  // Initialize chart
  initChart();
}

/**
 * Initialize Chart.js instance
 */
function initChart() {
  const ctx = document.getElementById('onoff-chart').getContext('2d');

  // Initial data buffer
  for (let i = 0; i < 100; i++) {
    chartData.labels.push('');
    chartData.datasets[0].data.push(null);
    chartData.datasets[1].data.push(null);
    chartData.datasets[2].data.push(null);
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#888'
          }
        },
        x: {
          display: false
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#ccc'
          }
        }
      }
    }
  });
}

/**
 * Add additional CSS for visualizer
 */
function addVisualizerStyles() {
  if (document.getElementById('onoff-styles')) return;

  const style = document.createElement('style');
  style.id = 'onoff-styles';
  style.textContent = `
    .onoff-visualizer {
      margin-top: 1rem;
    }
    .visualizer-bar {
      position: relative;
      height: 30px;
      background: var(--bg-color);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      overflow: visible;
    }
    .visualizer-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--gold-dim), var(--gold-accent));
      transition: width 0.2s ease;
    }
    .visualizer-marker {
      position: absolute;
      top: -5px;
      bottom: -5px;
      width: 2px;
      transform: translateX(-50%);
    }
    .visualizer-marker.sp {
      background: var(--gold-accent);
      box-shadow: 0 0 6px var(--gold-accent);
    }
    .visualizer-marker.high {
      background: var(--danger);
    }
    .visualizer-marker.low {
      background: var(--info);
    }
    .visualizer-pointer {
      position: absolute;
      top: 50%;
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 10px solid #fff;
      transform: translate(-50%, -50%) rotate(180deg);
      transition: left 0.2s ease;
    }
    .visualizer-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 0.5rem;
      font-size: 0.65rem;
      color: var(--text-dim);
    }
    .control-log {
      max-height: 120px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.7rem;
      color: var(--text-dim);
    }
    .control-log .log-entry {
      padding: 0.25rem 0;
      border-bottom: 1px dotted var(--border-color);
    }
    .control-log .log-time {
      color: var(--gold-dim);
      margin-right: 0.5rem;
    }
    .control-log .log-output-on {
      color: var(--success);
    }
    .control-log .log-output-off {
      color: var(--danger);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // ADC selector
  document.querySelectorAll('#adc-selector .radio-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#adc-selector .radio-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      item.querySelector('input').checked = true;
      selectedAdc = parseInt(item.dataset.adc);
    });
  });

  // DAC selector
  document.querySelectorAll('.dac-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dac-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDac = btn.dataset.dac;
    });
  });

  // Setpoint/Hysteresis inputs
  const spInput = document.getElementById('setpoint-input');
  const hystInput = document.getElementById('hysteresis-input');

  [spInput, hystInput].forEach(input => {
    input.addEventListener('input', updateThresholds);
  });

  // Auto mode toggle
  const autoToggle = document.getElementById('auto-mode-toggle');
  autoToggle.addEventListener('change', () => {
    autoMode = autoToggle.checked;
    if (autoMode) {
      addLogEntry('Auto mode enabled');
    } else {
      addLogEntry('Auto mode disabled');
    }
  });

  // Apply button
  const applyBtn = document.getElementById('btn-apply-onoff');
  applyBtn.addEventListener('click', applyOutput);

  // Initial threshold update
  updateThresholds();
}

/**
 * Update threshold display and markers
 */
function updateThresholds() {
  const sp = parseFloat(document.getElementById('setpoint-input').value) || 50;
  const hyst = parseFloat(document.getElementById('hysteresis-input').value) || 5;
  const halfH = hyst / 2;

  const high = Math.min(100, sp + halfH);
  const low = Math.max(0, sp - halfH);

  document.getElementById('threshold-sp').textContent = sp.toFixed(1) + '%';
  document.getElementById('threshold-high').textContent = high.toFixed(1) + '%';
  document.getElementById('threshold-low').textContent = low.toFixed(1) + '%';

  // Update markers
  document.getElementById('sp-marker').style.left = sp + '%';
  document.getElementById('high-marker').style.left = high + '%';
  document.getElementById('low-marker').style.left = low + '%';

  // Recalculate output
  calculateOutput();
}

/**
 * Compute ON/OFF output based on hysteresis algorithm
 */
function computeOnOff(pv, sp, hyst, prevOut) {
  const halfH = hyst / 2;
  if (pv >= sp + halfH) return 0;
  if (pv <= sp - halfH) return 100;
  return prevOut;
}

/**
 * Calculate and display output
 */
function calculateOutput() {
  const sp = parseFloat(document.getElementById('setpoint-input').value) || 50;
  const hyst = parseFloat(document.getElementById('hysteresis-input').value) || 5;

  const output = computeOnOff(lastPv, sp, hyst, previousOutput);
  previousOutput = output;

  const dacValue = Math.round((output / 100) * 16383);

  document.getElementById('onoff-output').textContent = output;
  document.getElementById('onoff-dac-value').textContent = dacValue;

  return { output, dacValue };
}

/**
 * Apply output to selected DAC
 */
function applyOutput() {
  const { output, dacValue } = calculateOutput();

  if (sendCommandFn) {
    sendCommandFn(selectedDac, dacValue);
    addLogEntry(`Applied ${selectedDac} = ${dacValue} (${output}%)`);
  }
}

/**
 * Update ON/OFF control with new telemetry
 */
export function updateOnOffControl(telemetry) {
  if (!telemetry.adc || telemetry.adc.length <= selectedAdc) return;

  // Add null checks for DOM elements (tab might not be rendered yet)
  const pvElem = document.getElementById('onoff-pv');
  const pvRawElem = document.getElementById('onoff-pv-raw');
  const visualizerElem = document.getElementById('pv-visualizer');
  const pointerElem = document.getElementById('pv-pointer');

  if (!pvElem || !visualizerElem) {
    // ON/OFF tab not active, skip update
    return;
  }

  const rawValue = telemetry.adc[selectedAdc];
  const pvPercent = (rawValue / 16383) * 100;
  lastPv = pvPercent;

  // Update PV display
  pvElem.textContent = pvPercent.toFixed(1);
  if (pvRawElem) pvRawElem.textContent = rawValue;

  // Update visualizer
  visualizerElem.style.width = pvPercent + '%';
  if (pointerElem) pointerElem.style.left = pvPercent + '%';

  // Calculate output
  const { output, dacValue } = calculateOutput();

  // Update chart
  if (chart) {
    const sp = parseFloat(document.getElementById('setpoint-input').value) || 50;

    // Shift data
    chart.data.labels.shift();
    chart.data.labels.push('');

    chart.data.datasets[0].data.shift();
    chart.data.datasets[0].data.push(sp);

    chart.data.datasets[1].data.shift();
    chart.data.datasets[1].data.push(pvPercent);

    chart.data.datasets[2].data.shift();
    chart.data.datasets[2].data.push(output);

    chart.update('none'); // Efficient update
  }

  // Auto mode: automatically apply
  if (autoMode) {
    const sp = parseFloat(document.getElementById('setpoint-input').value) || 50;
    const hyst = parseFloat(document.getElementById('hysteresis-input').value) || 5;
    const newOutput = computeOnOff(pvPercent, sp, hyst, previousOutput);

    if (newOutput !== previousOutput) {
      previousOutput = newOutput;
      const newDacValue = Math.round((newOutput / 100) * 16383);

      if (sendCommandFn) {
        sendCommandFn(selectedDac, newDacValue);
        addLogEntry(`Auto: ${selectedDac} = ${newDacValue} (${newOutput}%)`, newOutput > 0);
      }
    }
  }
}

/**
 * Add entry to control log
 */
function addLogEntry(message, isOn = null) {
  const log = document.getElementById('control-log');
  if (!log) return;

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  let outputClass = '';
  if (isOn === true) outputClass = 'log-output-on';
  else if (isOn === false) outputClass = 'log-output-off';

  entry.innerHTML = `<span class="log-time">${time}</span><span class="${outputClass}">${message}</span>`;

  log.insertBefore(entry, log.firstChild);

  // Limit entries
  while (log.children.length > 50) {
    log.removeChild(log.lastChild);
  }
}

export { selectedAdc, selectedDac, autoMode };
