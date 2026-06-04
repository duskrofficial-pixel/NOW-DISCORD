/**
 * Sweep + CISD Mobile App Coordinator
 * Integrated with Binance (Crypto) & Finnhub (Forex/XAUUSD)
 * Supports Foreground/Background Services
 */

let scannerActive = false;
let wsConnection = null;
let lastAlertedTimestamps = {}; 
let strategyParams = { pL: 2, pR: 2, piL: 1, piR: 1, look: 5 };
let checkIntervalTimer = null;

// Page Load
document.addEventListener("DOMContentLoaded", () => {
    loadCachedSettings();
    loadBinanceCoins();
    initBackgroundPlugins();
});

// View Navigation
function switchView(viewName, btn) {
    document.querySelectorAll(".view-section").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById(`view-${viewName}`).classList.remove("hidden");
    btn.classList.add("active");
}

function writeLog(type, text) {
    const container = document.getElementById("terminal-container");
    if (!container) return;
    const timeStr = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = `console-line ${type.toLowerCase()}`;
    line.innerHTML = `[${timeStr}] ${text}`;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
}

function clearConsoleLog() {
    document.getElementById("terminal-container").innerHTML = "";
    writeLog("system", "Log cleared.");
}

function clearSignalsTable() {
    document.getElementById("signals-list").innerHTML = `<div class="no-data">No signals yet. Start the scanner.</div>`;
    writeLog("system", "Signal history cleared.");
}

// Background & Foreground Plugin Stubs (Capacitor)
async function initBackgroundPlugins() {
    try {
        if (window.Capacitor) {
            writeLog("system", "Capacitor environment detected. Initializing background tasks...");
            const { App } = window.Capacitor.Plugins;
            App.addListener('appStateChange', (state) => {
                if (!state.isActive && scannerActive) {
                    writeLog("info", "App minimized. Background service maintaining execution lock...");
                }
            });
        }
    } catch (e) {
        writeLog("system", "Running in browser environment. (No Capacitor plugins)");
    }
}

// Cache Management
function loadCachedSettings() {
    try {
        if (localStorage.getItem("discord_webhook")) document.getElementById("discord-webhook").value = localStorage.getItem("discord_webhook");
        if (localStorage.getItem("timeframe_select")) document.getElementById("timeframe-select").value = localStorage.getItem("timeframe_select");
        if (localStorage.getItem("xauusd_enabled") === "true") document.getElementById("enable-xauusd").checked = true;
        
        if (localStorage.getItem("pL")) {
            document.getElementById("param-p-left").value = localStorage.getItem("pL");
            document.getElementById("param-p-right").value = localStorage.getItem("pR");
            document.getElementById("param-pi-left").value = localStorage.getItem("piL");
            document.getElementById("param-pi-right").value = localStorage.getItem("piR");
            document.getElementById("param-look").value = localStorage.getItem("look");
        }
    } catch (e) {
        writeLog("error", "Cache load failed.");
    }
}

function saveSettingsToCache() {
    try {
        localStorage.setItem("discord_webhook", document.getElementById("discord-webhook").value.trim());
        localStorage.setItem("timeframe_select", document.getElementById("timeframe-select").value);
        localStorage.setItem("xauusd_enabled", document.getElementById("enable-xauusd").checked);
        
        const checkboxes = document.querySelectorAll(".coin-checkbox:checked");
        const selectedSymbols = Array.from(checkboxes).map(cb => cb.value).join(",");
        localStorage.setItem("symbols_list", selectedSymbols);
        
        localStorage.setItem("pL", document.getElementById("param-p-left").value);
        localStorage.setItem("pR", document.getElementById("param-p-right").value);
        localStorage.setItem("piL", document.getElementById("param-pi-left").value);
        localStorage.setItem("piR", document.getElementById("param-pi-right").value);
        localStorage.setItem("look", document.getElementById("param-look").value);
    } catch (e) {
        writeLog("warning", "Cache save failed.");
    }
}

function getConfiguration() {
    const discordWebhook = document.getElementById("discord-webhook").value.trim();
    const timeframe = document.getElementById("timeframe-select").value || "15m";
    const xauusdEnabled = document.getElementById("enable-xauusd").checked;
    
    const checkboxes = document.querySelectorAll(".coin-checkbox:checked");
    const symbols = Array.from(checkboxes).map(cb => cb.value);
    
    strategyParams = {
        pL: parseInt(document.getElementById("param-p-left").value) || 2,
        pR: parseInt(document.getElementById("param-p-right").value) || 2,
        piL: parseInt(document.getElementById("param-pi-left").value) || 1,
        piR: parseInt(document.getElementById("param-pi-right").value) || 1,
        look: parseInt(document.getElementById("param-look").value) || 5
    };

    return { discordWebhook, symbols, timeframe, xauusdEnabled };
}

// Map Binance Timeframes to Bybit Resolutions & Milliseconds
function mapTimeframeToBybit(tf) {
    const mapping = {
        "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
        "1h": "60", "2h": "120", "4h": "240", "6h": "360", "8h": "360", "12h": "720",
        "1d": "D", "3d": "D", "1w": "W", "1M": "M"
    };
    return mapping[tf] || "15";
}

function timeframeToMs(tf) {
    const msMap = {
        "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000,
        "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000, "8h": 28800000, "12h": 43200000,
        "1d": 86400000, "3d": 259200000, "1w": 604800000, "1M": 2592000000
    };
    return msMap[tf] || 900000;
}

// Discord Webhook
async function sendDiscordAlert(webhookUrl, symbol, timeframe, isLong, price, isTest = false) {
    if (!webhookUrl) return false;
    const direction = isLong ? "LONG 🚀" : "SHORT 🔻";
    const embedColor = isTest ? 5814770 : (isLong ? 3066993 : 15158332);
    const chartUrl = symbol === "XAUUSDT" ? `https://www.tradingview.com/chart/?symbol=BYBIT:XAUUSDT` : `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}`;

    const embed = {
        title: isTest ? "📱 Mobile App Connected" : `${direction} SIGNAL`,
        color: embedColor,
        description: isTest 
            ? "Your mobile app is successfully connected to Discord! Alerts will be pushed from your phone." 
            : `A confirmed Sweep + CISD pattern has completed on the **${timeframe}** timeframe.`,
        fields: [],
        timestamp: new Date().toISOString(),
        footer: { text: "Sweep Signals Mobile App" }
    };

    if (!isTest) {
        embed.fields.push(
            { name: "Symbol", value: `\`${symbol}\``, inline: true },
            { name: "Timeframe", value: `\`${timeframe}\``, inline: true },
            { name: "Trigger Price", value: `**$${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4})}**`, inline: true }
        );
    } else {
        embed.fields.push({ name: "Status", value: "✅ Online via Mobile App", inline: true });
    }

    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] })
        });
        writeLog("success", `Discord alert sent for ${symbol}.`);
    } catch (e) {
        writeLog("error", `Webhook fail: ${e.message}`);
    }
}

async function testDiscordConnection() {
    const { discordWebhook } = getConfiguration();
    if (!discordWebhook) {
        alert("Enter Discord Webhook in Settings.");
        return;
    }
    const btn = document.getElementById("btn-test-discord");
    btn.disabled = true;
    btn.textContent = "Sending...";
    writeLog("info", "Testing Discord Webhook...");
    await sendDiscordAlert(discordWebhook, "", "Test", false, 0, true);
    setTimeout(() => { btn.disabled = false; btn.textContent = "Test Discord Alert"; }, 2000);
}

// Binance Fetching & UI
async function loadBinanceCoins() {
    const container = document.getElementById("coin-selector-container");
    if (!container) return;
    try {
        const response = await fetch("https://api.binance.com/api/v3/exchangeInfo");
        const data = await response.json();
        let symbols = data.symbols.filter(s => s.quoteAsset === "USDT" && s.status === "TRADING").map(s => s.symbol);
        const majors = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "PEPEUSDT"];
        symbols = symbols.filter(s => !majors.includes(s));
        symbols = [...majors, ...symbols.sort()];

        container.innerHTML = "";
        let cachedSymbols = [];
        if (localStorage.getItem("symbols_list")) {
            cachedSymbols = localStorage.getItem("symbols_list").split(",").map(s => s.trim().toUpperCase());
        }

        symbols.forEach(sym => {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = sym;
            checkbox.className = "coin-checkbox";
            if (cachedSymbols.includes(sym)) checkbox.checked = true;
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(" " + sym));
            container.appendChild(label);
        });

        const searchInput = document.getElementById("coin-search");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const query = e.target.value.toLowerCase().trim();
                const labels = container.querySelectorAll("label");
                labels.forEach(lbl => { lbl.style.display = lbl.textContent.toLowerCase().includes(query) ? "flex" : "none"; });
            });
        }
    } catch (e) {
        container.innerHTML = `<div class="coin-selector-loading" style="color:var(--color-down)">Failed to load coins.</div>`;
    }
}

async function fetchBinanceCandles(symbol, timeframe, limit = 500) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    return data.map(item => ({
        timestamp: parseInt(item[0]),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        time: new Date(item[0])
    }));
}

// Bybit XAUUSDT Fetching
async function fetchBybitCandles(resolution, symbol) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${resolution}&limit=500`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Bybit API error ${response.status}`);
    const data = await response.json();
    
    if (data.retCode !== 0 || !data.result || !data.result.list) throw new Error(`Insufficient XAUUSDT data from Bybit`);
    
    let candles = [];
    const list = data.result.list.reverse(); // Bybit returns newest first, so we reverse it to chronological order
    for (let i = 0; i < list.length; i++) {
        candles.push({
            timestamp: parseInt(list[i][0]),
            open: parseFloat(list[i][1]),
            high: parseFloat(list[i][2]),
            low: parseFloat(list[i][3]),
            close: parseFloat(list[i][4]),
            volume: parseFloat(list[i][5]),
            time: new Date(parseInt(list[i][0]))
        });
    }
    return candles;
}

function addSignalToUI(timestamp, symbol, isLong, price) {
    const container = document.getElementById("signals-list");
    if (container.querySelector(".no-data")) container.innerHTML = "";

    const dateStr = new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const typeLabel = isLong ? "LONG" : "SHORT";
    const typeClass = isLong ? "long" : "short";

    const item = document.createElement("div");
    item.className = `signal-item ${typeClass}`;
    item.innerHTML = `
        <div>
            <div class="sig-sym">${symbol}</div>
            <div class="sig-time">${dateStr}</div>
        </div>
        <div>
            <div class="sig-price">$${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4})}</div>
            <div class="sig-badge ${typeClass}">${typeLabel}</div>
        </div>
    `;
    container.insertBefore(item, container.firstChild);
}

// Evaluation Logic
async function evaluateCandles(candles, symbol, discordWebhook, timeframe, isLiveTrigger = false) {
    try {
        if (candles.length < 50) return;
        
        const sim = runIndicatorSimulation(candles, strategyParams.pL, strategyParams.pR, strategyParams.piL, strategyParams.piR, strategyParams.look);
        
        if (!isLiveTrigger) {
            let found = 0;
            for (let i = 0; i < candles.length; i++) {
                if (sim.hitLongArr[i]) { addSignalToUI(candles[i].timestamp, symbol, true, candles[i].close); found++; }
                else if (sim.hitShortArr[i]) { addSignalToUI(candles[i].timestamp, symbol, false, candles[i].close); found++; }
            }
            lastAlertedTimestamps[symbol] = candles[candles.length - 2].timestamp;
            writeLog("success", `Initialized ${symbol}. Loaded ${candles.length} history. Signals found: ${found}`);
            return;
        }

        const closedCandleIdx = candles.length - 2; // We evaluate on the last fully CLOSED candle
        const closedCandle = candles[closedCandleIdx];
        const closedTimestamp = closedCandle.timestamp;

        if (lastAlertedTimestamps[symbol] === closedTimestamp) return;

        if (sim.hitLongArr[closedCandleIdx]) {
            writeLog("signal", `🚀 LONG: ${symbol} at $${closedCandle.close}`);
            addSignalToUI(closedTimestamp, symbol, true, closedCandle.close);
            sendDiscordAlert(discordWebhook, symbol, timeframe, true, closedCandle.close);
        } else if (sim.hitShortArr[closedCandleIdx]) {
            writeLog("signal", `🔻 SHORT: ${symbol} at $${closedCandle.close}`);
            addSignalToUI(closedTimestamp, symbol, false, closedCandle.close);
            sendDiscordAlert(discordWebhook, symbol, timeframe, false, closedCandle.close);
        }

        lastAlertedTimestamps[symbol] = closedTimestamp;
    } catch (e) {
        writeLog("error", `${symbol} err: ${e.message}`);
    }
}

function fetchXAUCandles(resolution, symbol) {
    // Try Bybit first, then fallback to Binance if needed
    return fetchBybitCandles(resolution, symbol)
        .catch(err => {
            writeLog('warning', `Bybit fetch failed for ${symbol}: ${err.message}. Trying Binance...`);
            // Binance uses the same symbol name (XAUUSDT) for gold USDT pair
            return fetchBinanceCandles(symbol, mapTimeframeToBybit(resolution), 500);
        });
}

// Polling interval for XAUUSD (Executes exactly when a candle closes)
function startXAUUSDPoll(discordWebhook, timeframe) {
    const msInterval = timeframeToMs(timeframe);
    const bybitRes = mapTimeframeToBybit(timeframe);
    const symbol = "XAUUSDT"; // Bybit uses XAUUSDT, Binance also uses XAUUSDT
    
    // Evaluate immediately for history using fallback logic
    writeLog("info", `Fetching XAUUSDT history from Bybit (fallback to Binance if needed, res: ${bybitRes})...`);
    fetchXAUCandles(bybitRes, symbol)
        .then(candles => evaluateCandles(candles, symbol, discordWebhook, timeframe, false))
        .catch(err => writeLog("error", `XAUUSDT Init Error: ${err.message}`));

    // Set interval to poll every candle timeframe + 15 seconds (to allow data to settle)
    checkIntervalTimer = setInterval(() => {
        writeLog("info", `XAUUSDT: Checking new ${timeframe} candle closure...`);
        fetchXAUCandles(bybitRes, symbol)
            .then(candles => evaluateCandles(candles, symbol, discordWebhook, timeframe, true))
            .catch(err => writeLog("error", `XAUUSDT Poll Error: ${err.message}`));
    }, msInterval);
}

// Scanner Lifecycle
function updateScannerUI(isActive) {
    const dot = document.getElementById("global-status-dot");
    const text = document.getElementById("global-status-text");
    const btn = document.getElementById("btn-toggle-scanner");
    
    if (isActive) {
        dot.className = "status-indicator-dot scanning";
        text.textContent = "SYSTEM ACTIVE & SCANNING";
        btn.innerHTML = `<span class="icon">⏹</span> STOP SCANNER`;
        btn.classList.add("active");
    } else {
        dot.className = "status-indicator-dot stopped";
        text.textContent = "SYSTEM OFFLINE";
        btn.innerHTML = `<span class="icon">▶</span> START SCANNER`;
        btn.classList.remove("active");
    }
}

async function startWebClient() {
    const { discordWebhook, symbols, timeframe, xauusdEnabled } = getConfiguration();
    
    if (!discordWebhook) { alert("Please configure Discord Webhook in Settings."); return; }
    if (symbols.length === 0 && !xauusdEnabled) { alert("Please select at least one asset or enable XAUUSD."); return; }

    saveSettingsToCache();
    scannerActive = true;
    updateScannerUI(true);
    writeLog("info", `Starting mobile scan engine for ${timeframe}...`);

    // XAUUSD Initialization (REST Polling via Background Timer)
    if (xauusdEnabled) {
        startXAUUSDPoll(discordWebhook, timeframe);
    }

    if (symbols.length === 0) return; // Only running XAUUSD

    // Crypto Initialization (Binance WebSockets)
    for (const sym of symbols) {
        try {
            const candles = await fetchBinanceCandles(sym, timeframe, 500);
            await evaluateCandles(candles, sym, discordWebhook, timeframe, false);
        } catch (e) {
            writeLog("error", `Binance init failed for ${sym}: ${e.message}`);
        }
    }

    try {
        const streamNames = symbols.map(s => `${s.toLowerCase()}@kline_${timeframe}`).join("/");
        const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streamNames}`;
        
        wsConnection = new WebSocket(wsUrl);
        wsConnection.onopen = () => writeLog("success", "Connected to Binance WSS.");
        wsConnection.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            const symbol = data.data.s;
            if (data.data.k.x) { // Candle closed
                writeLog("info", `Candle closed for ${symbol}. Syncing...`);
                setTimeout(async () => {
                    try {
                        const candles = await fetchBinanceCandles(symbol, timeframe, 500);
                        await evaluateCandles(candles, symbol, discordWebhook, timeframe, true);
                    } catch (e) { writeLog("error", `Sync err ${symbol}: ${e.message}`); }
                }, 1500);
            }
        };
        wsConnection.onerror = () => writeLog("error", `WSS Error. Automatically recovering...`);
        wsConnection.onclose = () => {
            if (scannerActive) {
                writeLog("warning", "WSS Dropped. Reconnecting...");
                setTimeout(startWebClient, 5000);
            }
        };
    } catch (e) {
        writeLog("error", `WSS connect failed: ${e}`);
    }
}

function stopWebClient() {
    scannerActive = false;
    if (wsConnection) { wsConnection.close(); wsConnection = null; }
    if (checkIntervalTimer) { clearInterval(checkIntervalTimer); checkIntervalTimer = null; }
    updateScannerUI(false);
    writeLog("system", "Scanner stopped.");
}

function toggleScanner() {
    if (scannerActive) stopWebClient();
    else startWebClient();
}
