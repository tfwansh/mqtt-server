/**
 * STM32 Dashboard - Chart Management
 * Chart.js configuration and updates
 */

// Chart configuration
const CHART_CONFIG = {
    maxPoints: 60,
    colors: ['#c5a059', '#3fcf8e', '#3f8fcf', '#cf3f8e', '#8f3fcf', '#cfaf3f'],
    gridColor: 'rgba(255, 255, 255, 0.05)',
    fontColor: '#888888',
};

// Chart instances
const charts = {
    adc: [],
    env: null,
};

// Chart data buffers
const chartData = {
    adc: Array.from({ length: 6 }, () => []),
    temp: [],
    humid: [],
    timestamps: [],
};

/**
 * Initialize all charts
 */
export function initCharts() {
    initAdcCharts();
    initEnvChart();
}

/**
 * Initialize ADC waveform charts
 */
function initAdcCharts() {
    const chartsGrid = document.getElementById('charts-grid');
    chartsGrid.innerHTML = '';

    for (let i = 0; i < 6; i++) {
        const container = document.createElement('div');
        container.className = 'chart-container';
        container.innerHTML = `
      <span class="chart-label">ADC${i + 1}</span>
      <canvas id="adc-chart-${i + 1}" class="chart-canvas"></canvas>
    `;
        chartsGrid.appendChild(container);

        const ctx = document.getElementById(`adc-chart-${i + 1}`).getContext('2d');
        charts.adc[i] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: CHART_CONFIG.colors[i],
                    backgroundColor: `${CHART_CONFIG.colors[i]}20`,
                    borderWidth: 1.5,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                },
                scales: {
                    x: {
                        display: false,
                    },
                    y: {
                        min: 0,
                        max: 16383, // 14-bit ADC
                        grid: {
                            color: CHART_CONFIG.gridColor,
                            drawBorder: false,
                        },
                        ticks: {
                            color: CHART_CONFIG.fontColor,
                            font: { size: 9, family: "'Lato', sans-serif" },
                            maxTicksLimit: 3,
                        },
                    },
                },
            },
        });
    }
}

/**
 * Initialize environment trend chart
 */
function initEnvChart() {
    const canvas = document.getElementById('env-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    charts.env = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Temperature',
                    data: [],
                    borderColor: '#cf3f3f',
                    backgroundColor: 'rgba(207, 63, 63, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    yAxisID: 'y',
                },
                {
                    label: 'Humidity',
                    data: [],
                    borderColor: '#3f8fcf',
                    backgroundColor: 'rgba(63, 143, 207, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    yAxisID: 'y1',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: CHART_CONFIG.fontColor,
                        font: { size: 10, family: "'Lato', sans-serif" },
                        boxWidth: 12,
                        padding: 10,
                    },
                },
            },
            scales: {
                x: {
                    display: false,
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 50,
                    grid: {
                        color: CHART_CONFIG.gridColor,
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#cf3f3f',
                        font: { size: 9, family: "'Lato', sans-serif" },
                        maxTicksLimit: 5,
                        callback: (value) => value + '°C',
                    },
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 100,
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#3f8fcf',
                        font: { size: 9, family: "'Lato', sans-serif" },
                        maxTicksLimit: 5,
                        callback: (value) => value + '%',
                    },
                },
            },
        },
    });
}

/**
 * Update ADC charts with new telemetry data
 */
export function updateCharts(telemetry) {
    if (!telemetry.adc) return;

    const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        minute: '2-digit',
        second: '2-digit',
    });

    telemetry.adc.forEach((value, i) => {
        chartData.adc[i].push(value);

        if (chartData.adc[i].length > CHART_CONFIG.maxPoints) {
            chartData.adc[i].shift();
        }

        if (charts.adc[i]) {
            charts.adc[i].data.labels = chartData.adc[i].map(() => '');
            charts.adc[i].data.datasets[0].data = [...chartData.adc[i]];
            charts.adc[i].update('none');
        }
    });
}

/**
 * Update environment chart with new telemetry data
 */
export function updateEnvChart(telemetry) {
    if (!charts.env) return;

    const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        minute: '2-digit',
        second: '2-digit',
    });

    chartData.timestamps.push(timestamp);
    chartData.temp.push(telemetry.temp || 0);
    chartData.humid.push(telemetry.humid || 0);

    if (chartData.timestamps.length > CHART_CONFIG.maxPoints) {
        chartData.timestamps.shift();
        chartData.temp.shift();
        chartData.humid.shift();
    }

    charts.env.data.labels = [...chartData.timestamps];
    charts.env.data.datasets[0].data = [...chartData.temp];
    charts.env.data.datasets[1].data = [...chartData.humid];
    charts.env.update('none');
}

/**
 * Clear all chart data
 */
export function clearCharts() {
    chartData.adc.forEach(arr => arr.length = 0);
    chartData.temp.length = 0;
    chartData.humid.length = 0;
    chartData.timestamps.length = 0;

    charts.adc.forEach(chart => {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update('none');
        }
    });

    if (charts.env) {
        charts.env.data.labels = [];
        charts.env.data.datasets.forEach(ds => ds.data = []);
        charts.env.update('none');
    }
}

export { charts };
