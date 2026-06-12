import * as vscode from 'vscode'

export class StoragePanel {
  public static currentPanel: StoragePanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private _disposables: vscode.Disposable[] = []

  private constructor(
    panel: vscode.WebviewPanel,
    onMessage: (data: any) => Promise<void>
  ) {
    this._panel = panel
    this._panel.webview.html = this._getHtml()
    this._panel.webview.onDidReceiveMessage(onMessage, null, this._disposables)
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
  }

  public static open(context: vscode.ExtensionContext, onMessage: (data: any) => Promise<void>): StoragePanel {
    if (StoragePanel.currentPanel) {
      StoragePanel.currentPanel._panel.reveal(vscode.ViewColumn.One)
      return StoragePanel.currentPanel
    }
    const panel = vscode.window.createWebviewPanel(
      'oceanStorage',
      'Ocean Storage',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    StoragePanel.currentPanel = new StoragePanel(panel, onMessage)
    return StoragePanel.currentPanel
  }

  public sendMessage(message: any) {
    this._panel.webview.postMessage(message)
  }

  public dispose() {
    StoragePanel.currentPanel = undefined
    this._panel.dispose()
    this._disposables.forEach((d) => d.dispose())
    this._disposables = []
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Ocean Storage</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .toolbar h2 { margin: 0; font-size: 1.1em; flex: 1; }
  .content { padding: 16px; }
  button {
    font-family: inherit;
    font-size: inherit;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid transparent;
    padding: 4px 10px;
    border-radius: 2px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-ghost {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
  }
  .btn-ghost:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-danger {
    background: var(--vscode-errorForeground, #f48771);
    color: #fff;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    vertical-align: middle;
  }
  th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }
  tbody tr.clickable { cursor: pointer; }
  tbody tr.clickable:hover { background: var(--vscode-list-hoverBackground); }
  code {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
    background: var(--vscode-textBlockQuote-background);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .detail-header {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding-bottom: 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .detail-header > div { flex: 1 1 auto; min-width: 200px; font-size: 0.9em; }
  .detail-header .upload-btn { flex: 0 0 auto; }
  .empty-state {
    padding: 40px 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }
  .locked-state {
    padding: 60px 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }
  .locked-state strong { color: var(--vscode-foreground); display: block; margin-bottom: 8px; }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal-backdrop.open { display: flex; }
  .modal-card {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 20px;
    min-width: 460px;
    max-width: 620px;
    max-height: 80vh;
    overflow: auto;
  }
  .modal-card h3 { margin: 0 0 12px; }
  .modal-card label { display: block; margin: 12px 0 6px; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  .access-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
    align-items: center;
  }
  .modal-card input, .modal-card select {
    font-family: inherit;
    font-size: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    padding: 4px 6px;
    border-radius: 2px;
    box-sizing: border-box;
  }
  .modal-card > input { width: 100%; }
  .access-row select { width: 140px; }
  .access-row input { flex: 1; min-width: 0; }
  .access-row button { width: 28px; padding: 4px; }
  .access-row.invalid input { border-color: var(--vscode-errorForeground, #f48771); }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
  }
  .loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.2);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 50;
    color: var(--vscode-foreground);
  }
  .loading-overlay.open { display: flex; }
  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-notifications-background, var(--vscode-editor-background));
    color: var(--vscode-notifications-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-panel-border);
    padding: 8px 14px;
    border-radius: 4px;
    display: none;
    z-index: 200;
    max-width: 80%;
  }
  .toast.open { display: block; }
  .toast.error { border-color: var(--vscode-errorForeground, #f48771); }
  .mono { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .muted { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="backBtn" class="btn-ghost" style="display:none">\u2190 Back</button>
    <h2 id="title">Persistent Storage</h2>
    <div id="primaryActions">
      <button id="createBucketBtn">+ Create bucket</button>
    </div>
  </div>

  <div id="lockedState" class="locked-state" style="display:none">
    <strong>Persistent storage unavailable</strong>
    Configure node via dashboard to enable persistent storage.
  </div>

  <div id="bucketListView" class="content" style="display:none">
    <div id="bucketListEmpty" class="empty-state" style="display:none">
      No buckets yet. Click <strong>+ Create bucket</strong> to start.
    </div>
    <table id="bucketTable" style="display:none">
      <thead>
        <tr>
          <th style="width:70px">Output</th>
          <th>Name</th>
          <th>Bucket ID</th>
          <th>Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="bucketTableBody"></tbody>
    </table>
  </div>

  <div id="bucketDetailView" class="content" style="display:none">
    <div class="detail-header">
      <div>Bucket: <strong id="detailBucketName"></strong> <code id="detailBucketId"></code></div>
      <div>Owner: <code id="detailOwner"></code></div>
      <div>Access: <span id="detailAccess"></span></div>
      <button id="uploadBtn" class="upload-btn">\u2934 Upload file</button>
    </div>
    <div id="fileListEmpty" class="empty-state" style="display:none">
      No files in this bucket.
    </div>
    <table id="fileTable" style="display:none">
      <thead>
        <tr>
          <th style="width:70px">Mount</th>
          <th>Name</th>
          <th>Size</th>
          <th>Modified</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="fileTableBody"></tbody>
    </table>
  </div>

  <div id="createBucketModal" class="modal-backdrop">
    <div class="modal-card">
      <h3>New bucket</h3>
      <label>Name (optional)</label>
      <input id="bucketName" placeholder="Leave blank for an auto-generated name" />
      <label>Access list entry (optional)</label>
      <div class="access-row">
        <select id="accessChain"></select>
        <input id="accessContract" placeholder="0x… contract address (optional)" />
      </div>
      <div class="modal-actions">
        <button id="cancelCreateBtn" class="btn-secondary">Cancel</button>
        <button id="confirmCreateBtn">Create</button>
      </div>
    </div>
  </div>

  <div id="renameBucketModal" class="modal-backdrop">
    <div class="modal-card">
      <h3>Edit bucket name</h3>
      <label>Name</label>
      <input id="renameBucketName" placeholder="Leave blank to use the bucket ID" />
      <div class="modal-actions">
        <button id="cancelRenameBtn" class="btn-secondary">Cancel</button>
        <button id="confirmRenameBtn">Save</button>
      </div>
    </div>
  </div>

  <div id="loadingOverlay" class="loading-overlay">Loading\u2026</div>
  <div id="toast" class="toast"></div>

<script>
  const vscode = acquireVsCodeApi();

  const SUPPORTED_CHAINS = [
    { id: '8453', label: 'Base (8453)' },
    { id: '11155111', label: 'Sepolia (11155111)' },
    { id: '8996', label: 'Barge (8996)' }
  ];

  const state = {
    view: 'list',
    locked: false,
    buckets: [],
    currentBucket: null,
    files: [],
    pending: new Map(),
    configChainId: '',
    mounted: new Set(),
    renameTarget: null,
    outputBucketId: null
  };

  function mountKey(bucketId, fileName) {
    return bucketId + '/' + fileName;
  }

  let nextRequestId = 1;
  function call(type, payload) {
    const requestId = String(nextRequestId++);
    return new Promise((resolve, reject) => {
      state.pending.set(requestId, { resolve, reject });
      vscode.postMessage(Object.assign({ type, requestId }, payload || {}));
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function chainLabel(id) {
    const c = SUPPORTED_CHAINS.find((x) => x.id === String(id));
    return c ? c.label : 'Chain ' + id;
  }

  function formatAccessLists(lists) {
    if (!lists || !lists.length) return 'owner-only';
    const parts = [];
    for (const list of lists) {
      for (const chainId of Object.keys(list)) {
        for (const contract of list[chainId] || []) {
          parts.push(chainLabel(chainId) + ' / ' + contract);
        }
      }
    }
    return parts.length ? parts.join(', ') : 'owner-only';
  }

  function shortId(id) {
    if (!id) return '';
    return id.length > 20 ? id.slice(0, 8) + '\u2026' + id.slice(-6) : id;
  }

  function formatBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function formatDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function showToast(msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast open' + (kind === 'error' ? ' error' : '');
    setTimeout(() => { el.classList.remove('open'); }, 3500);
  }

  function setLoading(on) {
    document.getElementById('loadingOverlay').classList.toggle('open', !!on);
  }

  function renderLocked() {
    state.locked = true;
    document.getElementById('lockedState').style.display = 'block';
    document.getElementById('bucketListView').style.display = 'none';
    document.getElementById('bucketDetailView').style.display = 'none';
    document.getElementById('primaryActions').style.display = 'none';
    document.getElementById('backBtn').style.display = 'none';
  }

  function renderList() {
    state.view = 'list';
    state.currentBucket = null;
    document.getElementById('lockedState').style.display = 'none';
    document.getElementById('bucketListView').style.display = 'block';
    document.getElementById('bucketDetailView').style.display = 'none';
    document.getElementById('primaryActions').innerHTML = '<button id="createBucketBtn">+ Create bucket</button>';
    document.getElementById('createBucketBtn').addEventListener('click', openCreateModal);
    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('title').textContent = 'Persistent Storage';

    const tbody = document.getElementById('bucketTableBody');
    tbody.innerHTML = '';
    if (!state.buckets.length) {
      document.getElementById('bucketListEmpty').style.display = 'block';
      document.getElementById('bucketTable').style.display = 'none';
      return;
    }
    document.getElementById('bucketListEmpty').style.display = 'none';
    document.getElementById('bucketTable').style.display = '';
    for (const b of state.buckets) {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      const outputCell = document.createElement('td');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'outputBucket';
      radio.checked = state.outputBucketId === b.bucketId;
      radio.title = 'Set as output bucket for compute jobs';
      radio.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = state.outputBucketId === b.bucketId ? null : b.bucketId;
        try {
          await call('setOutputBucket', {
            bucketId: next,
            bucketName: next ? (b.label || b.bucketId) : null
          });
          state.outputBucketId = next;
        } catch (err) {
          handleStorageError(err);
        }
        renderList();
      });
      outputCell.appendChild(radio);
      const nameCell = document.createElement('td');
      nameCell.textContent = b.label ? b.label : shortId(b.bucketId);
      const idCell = document.createElement('td');
      idCell.innerHTML =
        '<code title="' + escHtml(b.bucketId) + '">' + escHtml(shortId(b.bucketId)) + '</code>';
      const createdCell = document.createElement('td');
      createdCell.textContent = formatDate(b.createdAt);
      const actCell = document.createElement('td');
      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn-ghost';
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRenameModal(b);
      });
      actCell.appendChild(renameBtn);
      tr.appendChild(outputCell);
      tr.appendChild(nameCell);
      tr.appendChild(idCell);
      tr.appendChild(createdCell);
      tr.appendChild(actCell);
      tr.addEventListener('click', () => openBucket(b));
      tbody.appendChild(tr);
    }
  }

  async function openBucket(b) {
    state.currentBucket = b;
    state.files = [];
    state.view = 'detail';
    document.getElementById('lockedState').style.display = 'none';
    document.getElementById('bucketListView').style.display = 'none';
    document.getElementById('bucketDetailView').style.display = 'block';
    document.getElementById('primaryActions').innerHTML = '';
    document.getElementById('backBtn').style.display = '';
    document.getElementById('title').textContent = 'Bucket';
    const bucketName = b.label && b.label.trim() ? b.label : null;
    document.getElementById('detailBucketName').textContent = bucketName || b.bucketId;
    document.getElementById('detailBucketId').textContent = bucketName ? '(' + b.bucketId + ')' : '';
    document.getElementById('detailOwner').textContent = b.owner || '';
    document.getElementById('detailAccess').textContent = formatAccessLists(b.accessLists);
    document.getElementById('fileTableBody').innerHTML = '';
    document.getElementById('fileTable').style.display = 'none';
    document.getElementById('fileListEmpty').style.display = 'none';

    setLoading(true);
    try {
      const res = await call('listFiles', { bucketId: b.bucketId });
      state.files = res.files || [];
      renderFiles();
    } catch (e) {
      handleStorageError(e);
    } finally {
      setLoading(false);
    }
  }

  function renderFiles() {
    const tbody = document.getElementById('fileTableBody');
    tbody.innerHTML = '';
    if (!state.files.length) {
      document.getElementById('fileListEmpty').style.display = 'block';
      document.getElementById('fileTable').style.display = 'none';
      return;
    }
    document.getElementById('fileListEmpty').style.display = 'none';
    document.getElementById('fileTable').style.display = '';
    const bucketId = state.currentBucket && state.currentBucket.bucketId;
    for (const f of state.files) {
      const tr = document.createElement('tr');
      const mountCell = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.mounted.has(mountKey(bucketId, f.name));
      checkbox.title = 'Mount as compute dataset';
      checkbox.addEventListener('change', () => toggleMount(f.name, checkbox.checked));
      mountCell.appendChild(checkbox);
      const nameCell = document.createElement('td');
      nameCell.textContent = f.name;
      const sizeCell = document.createElement('td');
      sizeCell.textContent = formatBytes(f.size);
      const modCell = document.createElement('td');
      modCell.textContent = formatDate(f.lastModified);
      const actCell = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-ghost';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteFile(f.name));
      actCell.appendChild(delBtn);
      tr.appendChild(mountCell);
      tr.appendChild(nameCell);
      tr.appendChild(sizeCell);
      tr.appendChild(modCell);
      tr.appendChild(actCell);
      tbody.appendChild(tr);
    }
  }

  async function toggleMount(fileName, mounted) {
    if (!state.currentBucket) return;
    const bucketId = state.currentBucket.bucketId;
    const key = mountKey(bucketId, fileName);
    if (mounted) state.mounted.add(key);
    else state.mounted.delete(key);
    try {
      await call('toggleMount', { bucketId, fileName, mounted });
    } catch (e) {
      if (mounted) state.mounted.delete(key);
      else state.mounted.add(key);
      renderFiles();
      handleStorageError(e);
    }
  }

  async function deleteFile(fileName) {
    if (!state.currentBucket) return;
    try {
      const res = await call('deleteFile', { bucketId: state.currentBucket.bucketId, fileName });
      if (res.type === 'fileDeleted') {
        state.files = state.files.filter((f) => f.name !== res.fileName);
        state.mounted.delete(mountKey(res.bucketId, res.fileName));
        renderFiles();
        showToast('File deleted.');
      }
    } catch (e) {
      handleStorageError(e);
    }
  }

  async function uploadFile() {
    if (!state.currentBucket) return;
    try {
      const res = await call('pickAndUploadFile', { bucketId: state.currentBucket.bucketId });
      if (res.type === 'fileUploaded') {
        state.files = [res.file, ...state.files.filter((f) => f.name !== res.file.name)];
        renderFiles();
        showToast('File uploaded.');
      }
    } catch (e) {
      handleStorageError(e);
    }
  }

  function populateChainSelect() {
    const sel = document.getElementById('accessChain');
    sel.innerHTML = '';
    for (const c of SUPPORTED_CHAINS) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      if (state.configChainId && state.configChainId === c.id) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function openCreateModal() {
    populateChainSelect();
    document.getElementById('accessContract').value = '';
    document.getElementById('bucketName').value = '';
    document.getElementById('createBucketModal').classList.add('open');
  }

  function closeCreateModal() {
    document.getElementById('createBucketModal').classList.remove('open');
  }

  function openRenameModal(b) {
    state.renameTarget = b.bucketId;
    document.getElementById('renameBucketName').value = b.label || '';
    document.getElementById('renameBucketModal').classList.add('open');
  }

  function closeRenameModal() {
    state.renameTarget = null;
    document.getElementById('renameBucketModal').classList.remove('open');
  }

  async function confirmRename() {
    if (!state.renameTarget) return;
    const bucketId = state.renameTarget;
    const label = document.getElementById('renameBucketName').value.trim();
    closeRenameModal();
    setLoading(true);
    try {
      const res = await call('renameBucket', { bucketId, label });
      const newLabel = res && res.label != null ? res.label : (label || null);
      state.buckets = state.buckets.map((b) =>
        b.bucketId === bucketId ? Object.assign({}, b, { label: newLabel }) : b
      );
      if (state.view === 'list') renderList();
      showToast('Bucket name updated.');
    } catch (e) {
      handleStorageError(e);
    } finally {
      setLoading(false);
    }
  }


  function rollAccessLists() {
    const chainId = document.getElementById('accessChain').value.trim();
    const contract = document.getElementById('accessContract').value.trim();
    if (!contract) return [];
    if (!chainId) throw new Error('Chain is required when a contract is provided');
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) {
      throw new Error('Invalid contract address: ' + contract);
    }
    return [{ [chainId]: [contract] }];
  }

  async function confirmCreate() {
    let accessLists;
    try {
      accessLists = rollAccessLists();
    } catch (e) {
      showToast(e.message || 'Invalid access list', 'error');
      return;
    }
    const label = document.getElementById('bucketName').value.trim();
    closeCreateModal();
    setLoading(true);
    try {
      const res = await call('createBucket', { accessLists, label: label || undefined });
      if (res.type === 'bucketCreated') {
        const entry = {
          bucketId: res.bucket.bucketId,
          owner: res.bucket.owner,
          createdAt: res.bucket.createdAt != null ? res.bucket.createdAt * 1000 : Date.now(),
          accessLists: res.bucket.accessList || [],
          label: res.bucket.label != null ? res.bucket.label : (label || null)
        };
        state.buckets = [entry, ...state.buckets];
        renderList();
        showToast('Bucket created.');
      }
    } catch (e) {
      handleStorageError(e);
    } finally {
      setLoading(false);
    }
  }

  function handleStorageError(e) {
    const msg = (e && e.message) || 'Unknown error';
    showToast(msg, 'error');
    if (e && (e.code === 'auth_expired' || e.code === 'missing_config')) {
      renderLocked();
    }
  }

  async function refreshBuckets() {
    if (state.locked) return;
    setLoading(true);
    try {
      const res = await call('listBuckets');
      state.buckets = (res.buckets || []).map((b) => ({
        ...b,
        createdAt: b.createdAt != null ? b.createdAt * 1000 : null
      }));
      renderList();
    } catch (e) {
      handleStorageError(e);
    } finally {
      setLoading(false);
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'configSnapshot') {
      state.configChainId = data.chainId != null ? String(data.chainId) : '';
      const ready = !!data.hasAuthToken && !!data.nodeUri && !!data.address && data.chainId != null;
      if (!ready) {
        renderLocked();
      } else {
        state.locked = false;
        refreshBuckets();
      }
      return;
    }
    if (data.type === 'mountedSnapshot') {
      state.mounted = new Set((data.entries || []).map((e) => mountKey(e.bucketId, e.fileName)));
      if (state.view === 'detail') renderFiles();
      return;
    }
    if (data.type === 'outputBucketSnapshot') {
      state.outputBucketId = data.bucketId || null;
      if (state.view === 'list') renderList();
      return;
    }
    if (data.requestId && state.pending.has(data.requestId)) {
      const entry = state.pending.get(data.requestId);
      state.pending.delete(data.requestId);
      if (data.type === 'storageError') entry.reject(data);
      else entry.resolve(data);
    }
  });

  document.getElementById('backBtn').addEventListener('click', renderList);
  document.getElementById('uploadBtn').addEventListener('click', uploadFile);
  document.getElementById('cancelCreateBtn').addEventListener('click', closeCreateModal);
  document.getElementById('confirmCreateBtn').addEventListener('click', confirmCreate);
  document.getElementById('cancelRenameBtn').addEventListener('click', closeRenameModal);
  document.getElementById('confirmRenameBtn').addEventListener('click', confirmRename);

  renderList();
</script>
</body>
</html>`
  }
}
