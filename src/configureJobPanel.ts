import * as vscode from 'vscode'
import { webviewCss } from './webviewStyles'
import { SUPPORTED_TOKENS_BASE } from './helpers/constants'

export class ConfigureJobPanel {
  public static currentPanel: ConfigureJobPanel | undefined

  private readonly _panel: vscode.WebviewPanel
  private _disposables: vscode.Disposable[] = []
  private _pollTimer: ReturnType<typeof setInterval> | undefined
  private _onMessage: (data: any) => Promise<void>

  private constructor(
    panel: vscode.WebviewPanel,
    onMessage: (data: any) => Promise<void>
  ) {
    this._onMessage = onMessage
    this._panel = panel
    this._panel.webview.html = this._getHtml()
    this._panel.webview.onDidReceiveMessage((data) => this._onMessage(data), null, this._disposables)
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    this._panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          this._startPoll()
        } else {
          this._stopPoll()
        }
      },
      null,
      this._disposables
    )
  }

  public static open(
    context: vscode.ExtensionContext,
    onMessage: (data: any) => Promise<void>
  ): ConfigureJobPanel {
    if (ConfigureJobPanel.currentPanel) {
      ConfigureJobPanel.currentPanel._panel.reveal(vscode.ViewColumn.One)
      ConfigureJobPanel.currentPanel._onMessage = onMessage
      return ConfigureJobPanel.currentPanel
    }
    const panel = vscode.window.createWebviewPanel(
      'oceanConfigureJob',
      'Configure Job',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    ConfigureJobPanel.currentPanel = new ConfigureJobPanel(panel, onMessage)
    ConfigureJobPanel.currentPanel._startPoll()
    return ConfigureJobPanel.currentPanel
  }

  public sendMessage(message: any) {
    this._panel.webview.postMessage(message)
  }

  public dispose() {
    this._stopPoll()
    ConfigureJobPanel.currentPanel = undefined
    this._panel.dispose()
    this._disposables.forEach((d) => d.dispose())
    this._disposables = []
  }

  private _startPoll() {
    if (this._pollTimer !== undefined) { return }
    this._pollTimer = setInterval(() => {
      this._panel.webview.postMessage({ type: '_pollBalance' })
    }, 10000)
  }

  private _stopPoll() {
    if (this._pollTimer !== undefined) {
      clearInterval(this._pollTimer)
      this._pollTimer = undefined
    }
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Configure Job</title>
<style>
${webviewCss()}

/* ============================================================
   Panel-specific overrides
   ============================================================ */
.panel-layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  grid-template-rows: auto;
  gap: var(--sp-4);
  padding: var(--sp-4);
  align-items: start;
  max-width: 1100px;
}

@media (max-width: 720px) {
  .panel-layout {
    grid-template-columns: 1fr;
  }
  .panel-sidebar {
    position: static;
  }
}

.panel-main {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
}

.panel-sidebar {
  position: sticky;
  top: calc(var(--sp-3) + 44px); /* toolbar height */
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* Section card titles */
.section-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--vscode-foreground);
  margin: 0 0 var(--sp-3) 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Slider grid: label | slider | value */
.slider-grid {
  display: grid;
  grid-template-columns: 90px 1fr 70px;
  align-items: center;
  gap: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-1);
}

.slider-label {
  font-size: var(--fs-sm);
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.slider-unit {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--fs-xs);
  color: var(--vscode-descriptionForeground);
  text-align: right;
  white-space: nowrap;
}

/* GPU checkboxes */
.gpu-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.gpu-label {
  font-size: var(--fs-sm);
  color: var(--vscode-descriptionForeground);
  width: 90px;
  flex-shrink: 0;
}

.gpu-checks {
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
}

.gpu-item {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-sm);
}

/* Input row for dataset */
.input-row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
}

.input-row input {
  flex: 1;
  min-width: 0;
}

/* Cost strip — the signature element */
.cost-strip {
  background: color-mix(in srgb, var(--vscode-button-background) 8%, var(--vscode-editor-background));
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
}

.cost-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}

.cost-label {
  font-size: var(--fs-xs);
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.cost-value {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--vscode-foreground);
}

.cost-value.computing {
  opacity: 0.5;
}

.balance-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}

.balance-warn {
  font-size: var(--fs-xs);
  color: var(--vscode-errorForeground);
}

/* Spinner — inline refresh indicator */
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--vscode-descriptionForeground);
  border-top-color: var(--vscode-button-background);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  vertical-align: middle;
  flex-shrink: 0;
}

.spinner.hidden { display: none; }

/* Footer actions */
.footer-actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.footer-actions .btn-pri {
  flex: 1;
}

/* Token select row */
.token-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.token-row label {
  font-size: var(--fs-sm);
  color: var(--vscode-descriptionForeground);
  margin-bottom: 0;
  white-space: nowrap;
}

.token-row select {
  width: auto;
  flex: 1;
}

/* Divider inside cost strip */
.cost-divider {
  border: none;
  border-top: 1px solid var(--vscode-panel-border);
  margin: var(--sp-2) 0;
}
</style>
</head>
<body>

<div class="toolbar">
  <h2 class="toolbar-title">Configure Job</h2>
  <div class="toolbar-actions">
    <button class="btn btn-ghost btn-sm" id="refreshEnvsBtn">Refresh envs</button>
  </div>
</div>

<div class="panel-layout">
  <!-- Main column -->
  <div class="panel-main">

    <!-- Environment -->
    <div class="card">
      <p class="section-title">Environment</p>
      <label for="envSelect">Compute environment</label>
      <select id="envSelect">
        <option value="">Loading environments…</option>
      </select>
      <div class="token-row" id="tokenRow" style="display:none">
        <label for="tokenSelect">Fee token</label>
        <select id="tokenSelect"></select>
      </div>
    </div>

    <!-- Resources -->
    <div class="card" id="resourcesCard">
      <p class="section-title">Resources</p>
      <div class="slider-grid" id="sliderGrid">
        <!-- CPU -->
        <span class="slider-label">CPU</span>
        <input type="range" id="cpuSlider" min="1" max="8" step="1" value="1">
        <span class="slider-unit" id="cpuVal">1 cores</span>
        <!-- RAM -->
        <span class="slider-label">RAM</span>
        <input type="range" id="ramSlider" min="1" max="16" step="1" value="1">
        <span class="slider-unit" id="ramVal">1 GB</span>
        <!-- Disk -->
        <span class="slider-label">Disk</span>
        <input type="range" id="diskSlider" min="1" max="100" step="1" value="1">
        <span class="slider-unit" id="diskVal">1 GB</span>
        <!-- Duration -->
        <span class="slider-label">Duration</span>
        <input type="range" id="durationSlider" min="300" max="86400" step="300" value="3600">
        <span class="slider-unit" id="durationVal">1 h</span>
      </div>
      <!-- GPU checkboxes injected here by JS if env has GPUs -->
      <div id="gpuSection" style="display:none">
        <div class="gpu-row">
          <span class="gpu-label">GPU</span>
          <div class="gpu-checks" id="gpuChecks"></div>
        </div>
      </div>
    </div>

    <!-- Inputs -->
    <div class="card">
      <p class="section-title">Inputs</p>
      <label for="datasetInput">Dataset URL or DID (optional)</label>
      <div class="input-row">
        <input type="text" id="datasetInput" placeholder="did:op:abc… or https://…">
        <button class="btn btn-ghost btn-sm" id="mountStorageBtn">Mount from storage ↗</button>
      </div>
    </div>

  </div><!-- /panel-main -->

  <!-- Sidebar: cost + escrow + actions -->
  <div class="panel-sidebar">

    <div class="cost-strip">
      <div class="cost-line">
        <span class="cost-label">Estimated cost</span>
        <span class="spinner hidden" id="costSpinner"></span>
      </div>
      <div class="cost-value computing" id="costValue">—</div>

      <hr class="cost-divider">

      <div class="cost-line">
        <span class="cost-label">Escrow balance</span>
        <span class="spinner hidden" id="balanceSpinner"></span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2);margin-bottom:var(--sp-1)">
        <span class="cost-value" id="balanceValue" style="font-size:var(--fs-base)">—</span>
        <span class="text-xs" id="balanceAge"></span>
      </div>
      <div id="balanceWarn" class="balance-warn" style="display:none">
        Insufficient balance to run this job
      </div>

      <hr class="cost-divider">

      <div class="footer-actions">
        <button class="btn btn-ghost btn-sm" id="addFundsBtn">Add funds ↗</button>
        <button class="btn btn-pri" id="saveBtn">Save</button>
      </div>
    </div>

  </div><!-- /panel-sidebar -->
</div><!-- /panel-layout -->

<div id="toast" class="toast"></div>

<script>
const vscode = acquireVsCodeApi();

// USDC + COMPY (Base) — single source of truth from helpers/constants.ts.
const SUPPORTED_TOKENS = ${JSON.stringify(
      SUPPORTED_TOKENS_BASE.map((t) => ({ symbol: t.symbol, address: t.address.toLowerCase() }))
    )};

// ============================================================
// State
// ============================================================
const state = {
  envs: [],
  selectedEnvId: '',
  selectedFeeToken: '',
  resources: { cpu: 1, ram: 1, disk: 1, durationSeconds: 3600 },
  gpuSelections: {},   // resourceId -> boolean
  cost: null,
  minLockSeconds: null,
  balance: null,
  balanceToken: '',
  balanceUpdatedAt: null,
  dataset: '',
  address: null,
  nodeId: null,
  connected: false,
  costPending: false,
  balancePending: false,
  pending: new Map()
};

// ============================================================
// requestId correlation (mirrors storagePanel pattern)
// ============================================================
let nextRequestId = 1;
function call(type, payload) {
  const requestId = String(nextRequestId++);
  return new Promise((resolve, reject) => {
    state.pending.set(requestId, { resolve, reject });
    vscode.postMessage(Object.assign({ type, requestId }, payload || {}));
  });
}

// ============================================================
// Utilities
// ============================================================
function showToast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast open' + (kind === 'error' ? ' error' : '');
  setTimeout(() => { el.classList.remove('open'); }, 3500);
}

function formatDuration(secs) {
  const s = Number(secs);
  if (s < 60) return s + ' s';
  if (s < 3600) return (s / 60).toFixed(0) + ' min';
  return (s / 3600 % 1 === 0 ? (s / 3600).toFixed(0) : (s / 3600).toFixed(1)) + ' h';
}

function formatAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  return Math.floor(s / 60) + 'm ago';
}

function shortNodeId(id) {
  if (!id) return '';
  return id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

// ============================================================
// Resource helpers derived from selected env
// ============================================================
function getEnvResource(env, id) {
  if (!env || !Array.isArray(env.resources)) return null;
  return env.resources.find((r) => r.id === id) || null;
}

function resourceBounds(env, id, defaults) {
  const r = getEnvResource(env, id);
  if (!r) return defaults;
  return {
    min: r.minimum ?? r.min ?? defaults.min,
    max: r.maximum ?? r.max ?? defaults.max,
    step: r.increment ?? r.step ?? defaults.step,
    defaultVal: r.default ?? defaults.defaultVal
  };
}

function applyEnvToSliders(env) {
  if (!env) return;

  const cpuBounds = resourceBounds(env, 'cpu', { min: 1, max: 8, step: 1, defaultVal: 1 });
  const ramBounds = resourceBounds(env, 'ram', { min: 1, max: 16, step: 1, defaultVal: 1 });
  const diskBounds = resourceBounds(env, 'disk', { min: 1, max: 100, step: 1, defaultVal: 1 });
  const durBounds = resourceBounds(env, 'duration', { min: 300, max: 86400, step: 300, defaultVal: 3600 });

  function applySlider(id, bounds, currentVal) {
    const el = document.getElementById(id);
    el.min = String(bounds.min);
    el.max = String(bounds.max);
    el.step = String(bounds.step);
    const clamp = Math.min(bounds.max, Math.max(bounds.min, currentVal || bounds.defaultVal));
    el.value = String(clamp);
    return clamp;
  }

  state.resources.cpu = applySlider('cpuSlider', cpuBounds, state.resources.cpu);
  state.resources.ram = applySlider('ramSlider', ramBounds, state.resources.ram);
  state.resources.disk = applySlider('diskSlider', diskBounds, state.resources.disk);
  state.resources.durationSeconds = applySlider('durationSlider', durBounds, state.resources.durationSeconds);

  updateReadouts();

  // GPU: look for resources with type 'gpu' or id containing 'gpu'
  const gpuResources = (env.resources || []).filter(
    (r) => (r.type || '').toLowerCase() === 'gpu' || r.id.toLowerCase().includes('gpu')
  );
  const gpuSection = document.getElementById('gpuSection');
  const gpuChecks = document.getElementById('gpuChecks');
  if (gpuResources.length > 0) {
    gpuChecks.innerHTML = '';
    for (const gr of gpuResources) {
      const id = 'gpu_' + gr.id;
      const item = document.createElement('label');
      item.className = 'gpu-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.checked = !!state.gpuSelections[gr.id];
      cb.addEventListener('change', () => {
        state.gpuSelections[gr.id] = cb.checked;
        scheduleCostEstimate();
      });
      const span = document.createElement('span');
      span.textContent = gr.label || gr.id;
      item.appendChild(cb);
      item.appendChild(span);
      gpuChecks.appendChild(item);
    }
    gpuSection.style.display = '';
  } else {
    gpuSection.style.display = 'none';
    state.gpuSelections = {};
  }
}

function updateReadouts() {
  const maxOf = (id) => document.getElementById(id).max;
  document.getElementById('cpuVal').textContent = state.resources.cpu + ' / ' + maxOf('cpuSlider') + ' cores';
  document.getElementById('ramVal').textContent = state.resources.ram + ' / ' + maxOf('ramSlider') + ' GB';
  document.getElementById('diskVal').textContent = state.resources.disk + ' / ' + maxOf('diskSlider') + ' GB';
  document.getElementById('durationVal').textContent = formatDuration(state.resources.durationSeconds);
}

// ============================================================
// Cost estimation — debounced 600ms
// ============================================================
let costDebounceTimer = null;
function scheduleCostEstimate() {
  if (costDebounceTimer) clearTimeout(costDebounceTimer);
  costDebounceTimer = setTimeout(runCostEstimate, 600);
  const costEl = document.getElementById('costValue');
  costEl.classList.add('computing');
}

async function runCostEstimate() {
  if (!state.selectedEnvId || !state.selectedFeeToken) {
    document.getElementById('costValue').textContent = '—';
    return;
  }
  if (state.costPending) return;
  state.costPending = true;
  const spinner = document.getElementById('costSpinner');
  spinner.classList.remove('hidden');
  const resources = buildResourcePayload();
  try {
    const res = await call('estimateCost', {
      envId: state.selectedEnvId,
      resources,
      durationSeconds: state.resources.durationSeconds,
      feeToken: state.selectedFeeToken
    });
    state.cost = res.cost ?? null;
    state.minLockSeconds = res.minLockSeconds ?? null;
    const costEl = document.getElementById('costValue');
    costEl.textContent = state.cost != null ? state.cost.toFixed(4) + ' ' + tokenSymbol(state.selectedFeeToken) : '—';
    costEl.classList.remove('computing');
    updateRunButton();
  } catch (e) {
    document.getElementById('costValue').textContent = 'estimate unavailable';
    state.cost = null;
  } finally {
    state.costPending = false;
    spinner.classList.add('hidden');
  }
}

function buildResourcePayload() {
  const base = [
    { id: 'cpu', amount: state.resources.cpu },
    { id: 'ram', amount: state.resources.ram },
    { id: 'disk', amount: state.resources.disk }
  ];
  for (const [id, checked] of Object.entries(state.gpuSelections)) {
    if (checked) base.push({ id, amount: 1 });
  }
  return base;
}

function tokenSymbol(address) {
  const lower = (address || '').toLowerCase();
  // Show the symbol ONLY for the known supported tokens (USDC / COMPY).
  const known = SUPPORTED_TOKENS.find((t) => t.address === lower);
  if (known) return known.symbol;
  // Any other token: show the shortened contract address (e.g. 0x5494…a4d2).
  return address ? address.slice(0, 6) + '…' + address.slice(-4) : '';
}

// ============================================================
// Balance fetch
// ============================================================
async function fetchBalance(feeToken) {
  if (!feeToken || state.balancePending) return;
  state.balancePending = true;
  const spinner = document.getElementById('balanceSpinner');
  spinner.classList.remove('hidden');
  try {
    const res = await call('getEscrowBalance', { feeToken });
    if (res.noAddress) {
      document.getElementById('balanceValue').textContent = 'connect wallet to view';
      state.balance = null;
    } else {
      state.balance = res.balance ?? 0;
      state.balanceToken = feeToken;
      state.balanceUpdatedAt = Date.now();
      document.getElementById('balanceValue').textContent =
        state.balance.toFixed(4) + ' ' + tokenSymbol(feeToken);
      startBalanceAgeTicker();
    }
    updateRunButton();
  } catch (e) {
    document.getElementById('balanceValue').textContent = 'unavailable';
    state.balance = null;
  } finally {
    state.balancePending = false;
    spinner.classList.add('hidden');
  }
}

let balanceAgeTicker = null;
function startBalanceAgeTicker() {
  if (balanceAgeTicker) return;
  balanceAgeTicker = setInterval(() => {
    const el = document.getElementById('balanceAge');
    if (el) el.textContent = formatAgo(state.balanceUpdatedAt);
  }, 5000);
}

// ============================================================
// Run button gating
// ============================================================
function updateRunButton() {
  const warn = document.getElementById('balanceWarn');
  const insufficient =
    state.balance !== null && state.cost !== null && state.balance < state.cost;
  if (warn) warn.style.display = insufficient ? '' : 'none';
}

// ============================================================
// Env select population
// ============================================================
function populateEnvSelect(envs) {
  const sel = document.getElementById('envSelect');
  sel.innerHTML = '';
  if (!envs || envs.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No environments available';
    sel.appendChild(opt);
    return;
  }
  for (const env of envs) {
    const opt = document.createElement('option');
    opt.value = env.envId;
    opt.textContent = env.label + ' (' + shortNodeId(env.nodeId) + ')';
    if (env.envId === state.selectedEnvId) opt.selected = true;
    sel.appendChild(opt);
  }
  // If no pre-selection, pick first
  if (!state.selectedEnvId && envs.length > 0) {
    state.selectedEnvId = envs[0].envId;
    sel.value = state.selectedEnvId;
  }
  onEnvChange();
}

function onEnvChange() {
  const envId = document.getElementById('envSelect').value;
  state.selectedEnvId = envId;
  const env = state.envs.find((e) => e.envId === envId);

  // Update token select
  const tokenRow = document.getElementById('tokenRow');
  const tokenSel = document.getElementById('tokenSelect');
  if (env && env.feeTokens && env.feeTokens.length > 0) {
    tokenRow.style.display = '';
    tokenSel.innerHTML = '';
    for (const addr of env.feeTokens) {
      const opt = document.createElement('option');
      opt.value = addr;
      opt.textContent = tokenSymbol(addr);
      if (addr === state.selectedFeeToken) opt.selected = true;
      tokenSel.appendChild(opt);
    }
    if (!env.feeTokens.includes(state.selectedFeeToken)) {
      state.selectedFeeToken = env.feeTokens[0];
      tokenSel.value = state.selectedFeeToken;
    }
  } else {
    tokenRow.style.display = 'none';
    state.selectedFeeToken = '';
  }

  applyEnvToSliders(env);
  scheduleCostEstimate();
  if (state.selectedFeeToken) fetchBalance(state.selectedFeeToken);
}

// ============================================================
// Message listener
// ============================================================
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  // Push messages from extension
  switch (data.type) {
    case 'configSnapshot':
      state.connected = !!data.connected;
      state.address = data.address || null;
      state.nodeId = data.nodeId || null;
      // Pre-select the env / fee token / resources the user is actually
      // working on (from the extension config). Falls back to the env's
      // own first values later in onEnvChange when config has none.
      if (data.environmentId) state.selectedEnvId = data.environmentId;
      if (data.feeToken) state.selectedFeeToken = data.feeToken;
      if (data.resources && typeof data.resources === 'object') {
        if (data.resources.cpu != null) state.resources.cpu = Number(data.resources.cpu);
        if (data.resources.ram != null) state.resources.ram = Number(data.resources.ram);
        if (data.resources.disk != null) state.resources.disk = Number(data.resources.disk);
      }
      if (data.durationSeconds != null) {
        state.resources.durationSeconds = Number(data.durationSeconds);
      }
      // If envs already loaded (snapshot arrived after listEnvs), re-apply.
      if (state.envs.length > 0) populateEnvSelect(state.envs);
      return;

    case 'envsLoaded':
      state.envs = data.envs || [];
      populateEnvSelect(state.envs);
      return;

    case 'costEstimated':
      // Handled via call() resolution
      break;

    case 'balanceUpdated': {
      // Pushed by extension poll
      const bal = data.balance;
      const tok = data.feeToken;
      if (bal != null) {
        state.balance = bal;
        state.balanceToken = tok;
        state.balanceUpdatedAt = Date.now();
        document.getElementById('balanceValue').textContent =
          bal.toFixed(4) + ' ' + tokenSymbol(tok);
        document.getElementById('balanceAge').textContent = 'just now';
        updateRunButton();
      }
      return;
    }

    case '_pollBalance':
      // Extension injected poll tick — request fresh balance
      if (state.selectedFeeToken && !state.balancePending) {
        fetchBalance(state.selectedFeeToken);
      }
      return;
  }

  // requestId correlation
  if (data.requestId && state.pending.has(data.requestId)) {
    const entry = state.pending.get(data.requestId);
    state.pending.delete(data.requestId);
    if (data.type === 'configureJobError') entry.reject(data);
    else entry.resolve(data);
  }
});

// ============================================================
// DOM event wiring
// ============================================================
document.getElementById('envSelect').addEventListener('change', onEnvChange);

document.getElementById('tokenSelect').addEventListener('change', () => {
  state.selectedFeeToken = document.getElementById('tokenSelect').value;
  scheduleCostEstimate();
  fetchBalance(state.selectedFeeToken);
});

['cpuSlider', 'ramSlider', 'diskSlider', 'durationSlider'].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const key = id.replace('Slider', '');
    if (key === 'duration') {
      state.resources.durationSeconds = Number(el.value);
    } else {
      state.resources[key] = Number(el.value);
    }
    updateReadouts();
    scheduleCostEstimate();
  });
});

document.getElementById('datasetInput').addEventListener('input', (e) => {
  state.dataset = e.target.value;
});

document.getElementById('mountStorageBtn').addEventListener('click', () => {
  vscode.postMessage({ type: 'mountFromStorage' });
});

document.getElementById('addFundsBtn').addEventListener('click', () => {
  const env = state.envs.find((e) => e.envId === state.selectedEnvId);
  const nodeId = env ? env.nodeId : state.nodeId;
  if (nodeId) {
    vscode.postMessage({ type: 'openFunding', nodeId });
  } else {
    showToast('No node selected', 'error');
  }
});

document.getElementById('refreshEnvsBtn').addEventListener('click', loadEnvs);

document.getElementById('saveBtn').addEventListener('click', async () => {
  const payload = buildSavePayload();
  if (!payload) return;
  try {
    await call('saveConfig', payload);
    showToast('Config saved');
  } catch (e) {
    showToast((e && e.message) || 'Save failed', 'error');
  }
});

function buildSavePayload() {
  if (!state.selectedEnvId) {
    showToast('Select an environment first', 'error');
    return null;
  }
  return {
    envId: state.selectedEnvId,
    resources: buildResourcePayload(),
    feeToken: state.selectedFeeToken,
    durationSeconds: state.resources.durationSeconds,
    dataset: state.dataset || undefined
  };
}

// ============================================================
// Initial load
// ============================================================
async function loadEnvs() {
  const sel = document.getElementById('envSelect');
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await call('listEnvs');
    state.envs = res.envs || [];
    populateEnvSelect(state.envs);
  } catch (e) {
    showToast((e && e.message) || 'Failed to load environments', 'error');
    sel.innerHTML = '<option value="">Failed to load</option>';
  }
}

loadEnvs();
</script>
</body>
</html>`
  }
}
