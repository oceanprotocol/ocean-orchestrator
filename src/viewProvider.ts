import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { SelectedConfig } from './types'
import {
  Language,
  getAvailableLanguages,
  getLanguageTemplates,
  detectProjectType,
  envTemplate,
  projectFileNames
} from './helpers/project-data'
import { generateJobName } from './helpers/jobNames'
import { DEFAULT_MULTIADDR } from './helpers/p2p'
import { webviewCss } from './webviewStyles'

export class OceanProtocolViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'oceanOrchestrator'
  private defaultMultiaddr = DEFAULT_MULTIADDR
  private config: SelectedConfig

  private _view?: vscode.WebviewView

  constructor(
    private readonly trackFn?: (event: string, props?: Record<string, unknown>) => void
  ) {}

  public notifyConfigUpdate(config: SelectedConfig) {
    this.config = config
    if (this._view?.webview) {
      this._view.webview.postMessage(this._buildStateUpdate(config))
    }
  }

  public sendMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message)
    }
  }

  private _buildStateUpdate(config: SelectedConfig) {
    const connected = !!config.authToken
    const mode: 'default-free' | 'connected-paid' = connected ? 'connected-paid' : 'default-free'

    let nodeId: string | undefined
    if (config.environmentId) {
      const id = config.environmentId
      nodeId = id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-6) : id
    } else if (config.multiaddresses?.[0] && config.multiaddresses[0] !== DEFAULT_MULTIADDR) {
      const addr = config.multiaddresses[0]
      const parts = addr.split('/')
      const peerId = parts[parts.length - 1]
      nodeId = peerId.length > 16 ? peerId.slice(0, 8) + '…' + peerId.slice(-6) : peerId
    }

    const envId = config.environmentId
    const envShort = envId
      ? (envId.length > 14 ? envId.slice(0, 8) + '…' + envId.slice(-6) : envId)
      : undefined

    return {
      type: 'stateUpdate',
      mode,
      status: { connected, nodeId, address: config.address, isFree: config.isFreeCompute },
      jobSummary: {
        envId,
        envShort,
        resources: config.resources ?? [],
        duration: config.jobDuration
      }
    }
  }

  private async closeOldProjectTabs() {
    try {
      const openEditors = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
      for (const tab of openEditors) {
        if (tab.input instanceof vscode.TabInputText) {
          const fileName = path.basename(tab.input.uri.fsPath)
          if (projectFileNames.includes(fileName)) {
            await vscode.window.tabGroups.close(tab)
          }
        }
      }
    } catch (error) {
      console.error('Error closing old project tabs:', error)
    }
  }

  private async openProjectFiles(projectPath: string) {
    try {
      const fileChecks = projectFileNames.map(async (fileName) => {
        const filePath = path.join(projectPath, fileName)
        const exists = await fs.promises
          .access(filePath)
          .then(() => true)
          .catch(() => false)
        return { fileName, filePath, exists }
      })

      const fileResults = await Promise.all(fileChecks)

      const openPromises = fileResults
        .filter((file) => file.exists)
        .map((file) =>
          vscode.window.showTextDocument(vscode.Uri.file(file.filePath), {
            preview: false
          })
        )

      await Promise.all(openPromises)
    } catch (error) {
      console.error('Error opening project files:', error)
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log('resolveWebviewView called')

    try {
      this._view = webviewView

      webviewView.webview.options = {
        enableScripts: true
      }

      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

      webviewView.webview.postMessage({ type: 'defaultJobName', name: generateJobName() })

      webviewView.webview.onDidReceiveMessage(async (data) => {
        console.log('Received message from webview:', data)

        try {
          switch (data.type) {
            case 'selectProjectFolder': {
              const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Project Folder'
              })

              if (folderUri && folderUri[0]) {
                await this.closeOldProjectTabs()
                await this.openProjectFiles(folderUri[0].fsPath)

                const projectType = await detectProjectType(folderUri[0].fsPath)
                const algorithmFileName =
                  getLanguageTemplates(projectType).algorithmFileName
                const algorithmPath = path.join(folderUri[0].fsPath, algorithmFileName)
                const resultsFolderPath = path.join(folderUri[0].fsPath, 'results')

                try {
                  await vscode.commands.executeCommand(
                    'revealInExplorer',
                    vscode.Uri.file(algorithmPath)
                  )
                } catch {
                }

                await vscode.commands.executeCommand(
                  'ocean-protocol.setSelectedProject',
                  algorithmPath,
                  resultsFolderPath
                )

                webviewView.webview.postMessage({
                  type: 'projectFolder',
                  path: folderUri[0].fsPath,
                  projectType: projectType,
                  algorithmPath,
                  algorithmFileName: algorithmFileName
                })
              }
              break
            }
            case 'createNewProjectFolder': {
              const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Parent Directory'
              })

              if (folderUri && folderUri[0]) {
                const projectName = await vscode.window.showInputBox({
                  prompt: 'Enter project folder name',
                  placeHolder: 'new-compute-job',
                  value: 'new-compute-job'
                })

                if (projectName) {
                  const availableLanguages = getAvailableLanguages()
                  const language = await vscode.window.showQuickPick(availableLanguages, {
                    placeHolder: 'Select preferred language',
                    title: 'Choose Language'
                  })

                  if (language) {
                    const projectPath = path.join(folderUri[0].fsPath, projectName)

                    try {
                      await fs.promises.mkdir(projectPath, { recursive: true })

                      const templates = getLanguageTemplates(language as Language)

                      if (templates.dockerfile) {
                        await fs.promises.writeFile(
                          path.join(projectPath, 'Dockerfile'),
                          templates.dockerfile
                        )
                      }
                      if (templates.dependencies && templates.dependenciesFileName) {
                        await fs.promises.writeFile(
                          path.join(projectPath, templates.dependenciesFileName),
                          templates.dependencies
                        )
                      }
                      await fs.promises.writeFile(
                        path.join(projectPath, templates.algorithmFileName),
                        templates.algorithm
                      )

                      await fs.promises.writeFile(
                        path.join(projectPath, '.env'),
                        envTemplate
                      )

                      const resultsPath = path.join(projectPath, 'results')
                      await fs.promises.mkdir(resultsPath, { recursive: true })

                      await this.closeOldProjectTabs()
                      await this.openProjectFiles(projectPath)

                      const algorithmPath = path.join(projectPath, templates.algorithmFileName)

                      try {
                        await vscode.commands.executeCommand(
                          'revealInExplorer',
                          vscode.Uri.file(algorithmPath)
                        )
                      } catch {
                      }

                      await vscode.commands.executeCommand(
                        'ocean-protocol.setSelectedProject',
                        algorithmPath,
                        resultsPath
                      )

                      webviewView.webview.postMessage({
                        type: 'projectCreated',
                        projectPath: projectPath,
                        algorithmPath,
                        resultsPath: resultsPath,
                        language: language
                      })
                    } catch (error) {
                      console.error('Error creating project:', error)
                      vscode.window.showErrorMessage(`Failed to create project: ${error}`)
                    }
                  }
                }
              }
              break
            }
            case 'runFreeJob':
              await vscode.commands.executeCommand('ocean-protocol.runFreeJob', {
                jobName: data.jobName,
                dockerImage: data.dockerImage,
                dockerTag: data.dockerTag
              })
              break
            case 'runJob':
              await vscode.commands.executeCommand('ocean-protocol.runJob', {
                jobName: data.jobName,
                dockerImage: data.dockerImage,
                dockerTag: data.dockerTag
              })
              break
            case 'stopJob':
              await vscode.commands.executeCommand(
                'ocean-protocol.stopComputeJob',
                this.config?.authToken
              )
              break
            case 'getJobs':
              await vscode.commands.executeCommand('ocean-protocol.loadJobs')
              break
            case 'selectJob':
              await vscode.commands.executeCommand('ocean-protocol.selectJob', data.jobId)
              break
            case 'downloadResults':
              await vscode.commands.executeCommand(
                'ocean-protocol.downloadResults',
                data.jobId,
                data.outputsURL
              )
              break
            case 'openStorage':
              await vscode.commands.executeCommand('ocean-protocol.openStoragePanel')
              break
            case 'connect':
              await vscode.commands.executeCommand('ocean-protocol.openConnectUrl')
              break
            case 'openConfigureJob':
              await vscode.commands.executeCommand('ocean-protocol.openConfigureJob')
              break
            case 'showLogs':
              await vscode.commands.executeCommand('ocean-protocol.showLogs')
              break
            case 'viewJobLogs':
              await vscode.commands.executeCommand('ocean-protocol.viewJobLogs', data.jobId)
              break
            case 'openExternalUrl':
              vscode.env.openExternal(vscode.Uri.parse(data.url))
              break
            case 'copyToClipboard':
              vscode.env.clipboard.writeText(data.text)
              break
            case 'getDefaultEnv':
              await vscode.commands.executeCommand('ocean-protocol.loadDefaultEnv')
              break
            case 'getState':
              if (this.config) {
                webviewView.webview.postMessage(this._buildStateUpdate(this.config))
              }
              break
          }
        } catch (error) {
          console.error('Error handling message:', error)
          vscode.window.showErrorMessage(`Error handling message: ${error}`)
        }
      })
    } catch (error) {
      console.error('Error in resolveWebviewView:', error)
      vscode.window.showErrorMessage(`Failed to resolve webview: ${error}`)
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const defaultMultiaddrEscaped = this.defaultMultiaddr.replace(/"/g, '\\"')
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Ocean Orchestrator</title>
  <style>
    ${webviewCss()}

    /* -----------------------------------------------------------------------
       Sidebar-specific overrides (300px column context)
    ----------------------------------------------------------------------- */
    body {
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: var(--sp-3) var(--sp-4);
    }

    /* Status line */
    #statusLine {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      margin-bottom: var(--sp-3);
    }
    #statusLine .status-dot {
      flex-shrink: 0;
    }
    #statusLine .status-text-wrap {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #refreshBtn {
      flex-shrink: 0;
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      font-size: 17px;
      line-height: 1;
      opacity: 0.6;
      transition: opacity var(--transition), background var(--transition);
    }
    #refreshBtn:hover:not(:disabled) {
      opacity: 1;
      background: var(--vscode-list-hoverBackground);
    }
    #refreshBtn:disabled {
      cursor: not-allowed;
      opacity: 0.35;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    #refreshBtn.spinning {
      animation: spin 0.8s linear infinite;
      opacity: 0.5;
    }

    /* Project section */
    .field {
      margin-bottom: var(--sp-2);
    }
    .field label {
      display: block;
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      margin-bottom: var(--sp-1);
    }
    .field input {
      width: 100%;
    }
    #dockerFields {
      display: none;
    }
    #dockerFields.visible {
      display: block;
    }
    .project-buttons {
      display: flex;
      gap: var(--sp-2);
      margin-top: var(--sp-1);
    }
    .project-buttons .btn {
      flex: 1;
    }
    #projectPath {
      display: block;
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      text-align: left;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--fs-xs);
      color: var(--vscode-foreground);
      margin: var(--sp-1) 0;
    }
    #projectPath.empty {
      direction: ltr;
    }
    #projectPath.empty {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-font-family);
    }

    /* Env summary card — connected-paid only */
    #envCard {
      display: none;
      margin-bottom: var(--sp-3);
    }
    #envCard.visible {
      display: block;
    }
    .env-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-2);
    }
    #configureJobBtn {
      padding: 2px var(--sp-2);
      flex: 0 0 auto;
    }
    .env-label {
      font-weight: 600;
      font-size: var(--fs-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .env-resources {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      margin-top: var(--sp-1);
    }

    /* Primary run button */
    #runBtn {
      width: 100%;
      font-size: var(--fs-sm);
      font-weight: 600;
      padding: var(--sp-2) var(--sp-3);
      margin-bottom: var(--sp-4);
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      cursor: pointer;
      font-family: inherit;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      transition: background var(--transition), opacity var(--transition);
    }
    #runBtn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    #runBtn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    #runBtn.btn-danger {
      background: var(--vscode-errorForeground);
      color: var(--vscode-editor-background);
    }
    #runBtn.btn-danger:hover:not(:disabled) {
      opacity: 0.85;
    }

    /* Timer */
    #elapsedTimer {
      display: none;
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      text-align: center;
      margin-top: calc(-1 * var(--sp-3));
      margin-bottom: var(--sp-3);
    }

    /* Jobs list */
    .jobs-list {
      margin-bottom: var(--sp-3);
    }
    .job-row {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-1) var(--sp-2);
      border-radius: var(--radius-sm);
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .job-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .job-row.selected {
      border-left-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
    }
    .job-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--fs-xs);
    }
    .job-time {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .no-jobs {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      padding: var(--sp-2);
      text-align: center;
    }

    /* Download results: primary style, matching the Run button */
    #downloadBtn {
      width: 100%;
      font-size: var(--fs-sm);
      font-weight: 600;
      padding: var(--sp-2) var(--sp-3);
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      cursor: pointer;
      font-family: inherit;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      transition: background var(--transition), opacity var(--transition);
    }
    #downloadBtn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    #downloadBtn:disabled {
      opacity: 0.45;
      cursor: default;
    }

    /* Job action buttons (under run button) */
    #jobActions {
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
      margin-top: calc(-1 * var(--sp-3));
      margin-bottom: var(--sp-3);
    }
    .job-act-btn {
      width: 100%;
      font-size: var(--fs-xs);
      padding: var(--sp-1) var(--sp-2);
      border-radius: var(--radius-sm);
      border: 1px solid var(--vscode-panel-border);
      cursor: pointer;
      font-family: inherit;
      background: transparent;
      color: var(--vscode-foreground);
      text-align: left;
      transition: background var(--transition), opacity var(--transition);
    }
    .job-act-btn:hover:not(:disabled) {
      background: var(--vscode-list-hoverBackground);
    }
    .job-act-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Footer links */
    .footer-links {
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
      margin-top: var(--sp-3);
    }
    .footer-links a {
      font-size: var(--fs-xs);
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .footer-links a:hover {
      text-decoration: underline;
    }

    .section-sep {
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 12px;
      margin-top: 4px;
    }
    .section-gap {
      margin-bottom: var(--sp-4);
    }
    .env-metric-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-top: var(--sp-2);
    }
    .env-metric-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .env-metric-val {
      font-size: 12px;
      color: var(--vscode-foreground);
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
    }
    .env-metric-val .mv-max {
      font-size: 9px;
      font-weight: 400;
      color: var(--vscode-descriptionForeground);
      margin-left: 2px;
    }
    .env-hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .env-metric-lbl {
      font-size: 9px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .env-node-sub {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      margin-top: var(--sp-1);
    }
  </style>
</head>
<body>

  <!-- STATUS LINE -->
  <div id="statusLine">
    <span class="status-dot running" id="statusDot"></span>
    <span class="status-text-wrap" id="statusText">Connecting…</span>
    <button id="refreshBtn" title="Refresh">&#8635;</button>
  </div>

  <!-- PROJECT -->
  <div class="section-gap section-sep">
    <span class="label-section">Project</span>
    <div class="field">
      <label for="jobNameInput">Job name</label>
      <input type="text" id="jobNameInput" placeholder="generating…">
    </div>
    <div class="project-buttons">
      <button class="btn btn-sm btn-ghost" id="selectFolderBtn" title="Select project">Select</button>
      <button class="btn btn-sm btn-ghost" id="newFolderBtn" title="New project">New</button>
    </div>
    <div id="projectPath" class="empty">No folder selected</div>
    <div id="dockerFields">
      <div class="field">
        <label for="dockerImageInput">Docker image</label>
        <input type="text" id="dockerImageInput" placeholder="e.g. python">
      </div>
      <div class="field">
        <label for="dockerTagInput">Docker tag</label>
        <input type="text" id="dockerTagInput" placeholder="e.g. 3.11-slim">
      </div>
    </div>
  </div>

  <!-- DEFAULT ENV CARD (default-free mode only) -->
  <div id="defaultEnvCard" class="card section-gap" style="display:none;">
    <div id="defaultEnvBody">
      <span class="text-xs">Checking default node...</span>
    </div>
  </div>

  <!-- ENV SUMMARY CARD (connected-paid, no job selected) -->
  <div id="envCard" class="card section-gap">
    <div class="env-card-row">
      <span id="envLabel" class="env-label">Selected environment</span>
      <button class="btn btn-sm btn-ghost" id="configureJobBtn">Configure &#9881;</button>
    </div>
    <div id="envHint" class="env-hint"></div>
    <div class="env-resources" id="envResources"></div>
    <div id="envCost" class="text-xs" style="margin-top: var(--sp-2);"></div>
    <div id="envBalance" class="text-xs"></div>
  </div>

  <!-- PRIMARY RUN BUTTON -->
  <button id="runBtn" disabled>&#9654; Run free test job</button>
  <div id="elapsedTimer">0:00 elapsed</div>

  <!-- JOB ACTION BUTTONS (operate on selected job) -->
  <div id="jobActions">
    <button id="downloadBtn" disabled>Download results</button>
  </div>

  <!-- JOBS -->
  <div class="section-gap section-sep">
    <span class="label-section">Jobs</span>
    <div class="jobs-list" id="jobsList">
      <div class="no-jobs">No jobs yet</div>
    </div>
  </div>

  <!-- FOOTER LINKS -->
  <div class="footer-links">
    <a href="#" id="connectLink" style="display:none;">Connect for paid environments &#8599;</a>
    <a href="#" id="storageLink">Manage storage &#8599;</a>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const defaultMultiaddr = "${defaultMultiaddrEscaped}";

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    let mode = 'default-free'; // 'default-free' | 'connected-paid'
    let connected = false;
    let nodeId = null;
    let projectPath = null;
    let algorithmPath = null;
    let resultsFolderPath = null;
    let projectType = null; // Language enum value; 'Docker Image' => show docker fields
    // The Dockerfile project type — docker image/tag fields are shown only for it.
    const DOCKER_PROJECT_TYPE = '${Language.DOCKER_IMAGE}';
    let isRunning = false;
    let elapsedSeconds = 0;
    let runningJobId = null;
    const JOBS_PAGE = 6;
    let jobsShown = JOBS_PAGE;
    let timerInterval = null;
    let jobs = [];
    let selectedJobId = null;
    // Default env capabilities (default-free mode)
    let defaultEnv = null; // null = loading, false = error, object = loaded
    let defaultEnvRequested = false;
    // Refresh / retry state
    let refreshInFlight = false;       // true while a manual/auto refresh is pending
    let refreshTimeoutId = null;       // safety timeout handle
    // Continuous retry loop for default env
    let retryIntervalId = null;        // interval handle for 5s retry loop
    // Connection status: 'connecting' | 'connected' | 'failed'
    let connStatus = 'connecting';
    // Connected-paid state
    let jobSummary = null;
    let walletAddress = null;
    let connectedFree = false;
    let envInfo = {};

    // -------------------------------------------------------------------------
    // DOM refs
    // -------------------------------------------------------------------------
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const refreshBtn = document.getElementById('refreshBtn');
    const defaultEnvCard = document.getElementById('defaultEnvCard');
    const defaultEnvBody = document.getElementById('defaultEnvBody');
    const projectPathEl = document.getElementById('projectPath');
    const jobNameInput = document.getElementById('jobNameInput');
    const dockerFields = document.getElementById('dockerFields');
    const dockerImageInput = document.getElementById('dockerImageInput');
    const dockerTagInput = document.getElementById('dockerTagInput');
    const envCard = document.getElementById('envCard');
    const envHint = document.getElementById('envHint');
    const envResources = document.getElementById('envResources');
    const envCostEl = document.getElementById('envCost');
    const envBalanceEl = document.getElementById('envBalance');
    const runBtn = document.getElementById('runBtn');
    const elapsedTimerEl = document.getElementById('elapsedTimer');
    const jobsListEl = document.getElementById('jobsList');
    const downloadBtn = document.getElementById('downloadBtn');
    const connectLink = document.getElementById('connectLink');
    const storageLink = document.getElementById('storageLink');

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function fmtElapsed(secs) {
      const m = Math.floor(secs / 60);
      const s = String(secs % 60).padStart(2, '0');
      return m + ':' + s;
    }

    // Local jobs store createdAt in ms (Date.now()); incentive jobs use epoch
    // seconds. Normalize everything to ms so formatting + sorting are consistent.
    function toMs(ts) {
      if (!ts || isNaN(ts)) return 0;
      return ts < 1e12 ? ts * 1000 : ts;
    }

    function shortId(id) {
      if (!id) return '';
      return id.length > 24 ? id.slice(0, 10) + '…' + id.slice(-6) : id;
    }

    function fmtTime(ts) {
      const ms = toMs(ts);
      if (!ms) return '';
      const d = new Date(ms);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function statusClass(s) {
      if (!s) return 'stopped';
      switch (s.toLowerCase()) {
        case 'running': return 'running';
        case 'completed': return 'completed';
        case 'failed': return 'failed';
        case 'stopped': return 'stopped';
        default: return 'queued';
      }
    }

    function fmtGB(gb) {
      if (gb == null) return null;
      return Math.round(gb) + ' GB';
    }

    function shortPeerId(id) {
      if (!id) return '';
      if (id.length <= 12) return id;
      return id.slice(0, 6) + '…' + id.slice(-4);
    }

    // -------------------------------------------------------------------------
    // Refresh helpers
    // -------------------------------------------------------------------------
    function setRefreshInFlight(inFlight) {
      refreshInFlight = inFlight;
      refreshBtn.disabled = inFlight;
      if (inFlight) {
        refreshBtn.classList.add('spinning');
        // Safety timeout — re-enable after 8s even if no response arrives
        clearTimeout(refreshTimeoutId);
        refreshTimeoutId = setTimeout(() => {
          setRefreshInFlight(false);
        }, 8000);
      } else {
        refreshBtn.classList.remove('spinning');
        clearTimeout(refreshTimeoutId);
        refreshTimeoutId = null;
      }
    }

    function startRetryLoop() {
      // Guard: only one interval running at a time
      if (retryIntervalId !== null) return;
      retryIntervalId = setInterval(() => {
        if (mode !== 'default-free' || (defaultEnv && defaultEnv !== false)) {
          stopRetryLoop();
          return;
        }
        connStatus = 'connecting';
        renderStatus();
        vscode.postMessage({ type: 'getDefaultEnv' });
      }, 5000);
    }

    function stopRetryLoop() {
      if (retryIntervalId !== null) {
        clearInterval(retryIntervalId);
        retryIntervalId = null;
      }
    }

    function doRefresh() {
      setRefreshInFlight(true);
      if (mode === 'default-free') {
        defaultEnv = null; // show "Checking…" during refresh
        connStatus = 'connecting';
        renderDefaultEnvCard();
        renderStatus();
        vscode.postMessage({ type: 'getDefaultEnv' });
      }
      vscode.postMessage({ type: 'getJobs' });
    }

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    function shortAddress(addr) {
      if (!addr) return '';
      return addr.slice(0, 6) + '…' + addr.slice(-4);
    }

    function renderStatus() {
      // Top status line reflects ONLY node connection + web3 address.
      // Job status never changes this line.
      if (walletAddress) {
        statusDot.className = 'status-dot completed'; // green
        statusText.textContent = walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
        return;
      }
      // No wallet — reflect default-node connection state
      switch (connStatus) {
        case 'connecting':
          statusDot.className = 'status-dot running'; // blue + animated
          statusText.textContent = 'Connecting…';
          break;
        case 'connected':
          statusDot.className = 'status-dot completed'; // green
          statusText.textContent = 'Connected';
          break;
        case 'failed':
          statusDot.className = 'status-dot failed'; // red
          statusText.textContent = 'Failed to connect';
          break;
        default:
          statusDot.className = 'status-dot stopped';
          statusText.textContent = 'Not connected';
      }
    }

    function renderDefaultEnvCard() {
      if (mode !== 'default-free') {
        defaultEnvCard.style.display = 'none';
        return;
      }
      defaultEnvCard.style.display = 'block';
      if (defaultEnv === null) {
        defaultEnvBody.innerHTML = '<span class="text-xs">Checking default node...</span>';
        return;
      }
      if (defaultEnv === false) {
        defaultEnvBody.innerHTML =
          '<div style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;">' +
          '<span class="text-xs">Default node unavailable</span>' +
          '<button id="retryEnvBtn" class="btn btn-sm btn-ghost" style="padding:1px var(--sp-2);">Retry now</button>' +
          '</div>';
        const retryBtn = document.getElementById('retryEnvBtn');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            // Immediate retry; the 5s loop continues independently
            defaultEnv = null;
            connStatus = 'connecting';
            renderDefaultEnvCard();
            renderStatus();
            setRefreshInFlight(true);
            vscode.postMessage({ type: 'getDefaultEnv' });
          });
        }
        return;
      }
      // Build metric grid
      const nodeLabel = shortPeerId(defaultEnv.nodeId) || 'default';
      const platformStr = (defaultEnv.os || defaultEnv.arch)
        ? ((defaultEnv.os || '') + (defaultEnv.os && defaultEnv.arch ? '/' : '') + (defaultEnv.arch || ''))
        : '';

      let cpuVal = null, ramVal = null, diskVal = null, gpuVal = null;
      if (defaultEnv.resources && defaultEnv.resources.length > 0) {
        for (const r of defaultEnv.resources) {
          const val = r.available != null ? r.available : r.max;
          if (r.id && r.id.includes('cpu')) cpuVal = val;
          else if (r.id && r.id.includes('ram')) ramVal = val;
          else if (r.id && r.id.includes('disk')) diskVal = val;
          // Anything else is a GPU (GPU resource ids are model/uuid, not 'gpu')
          else if (r.id) gpuVal = (gpuVal || 0) + val;
        }
      }

      let maxRunStr = null;
      if (defaultEnv.maxJobDuration != null) {
        const s = defaultEnv.maxJobDuration;
        if (s >= 3600) maxRunStr = Math.round(s / 3600) + 'h';
        else if (s >= 60) maxRunStr = Math.round(s / 60) + 'm';
        else maxRunStr = s + 's';
      }

      const subLine = [nodeLabel, platformStr].filter(Boolean).join(' · ');

      let cells = '';
      if (cpuVal != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + cpuVal + '</div><div class="env-metric-lbl">CPU</div></div>';
      if (ramVal != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + (fmtGB(ramVal) || ramVal) + '</div><div class="env-metric-lbl">RAM</div></div>';
      if (diskVal != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + (fmtGB(diskVal) || diskVal) + '</div><div class="env-metric-lbl">DISK</div></div>';
      if (gpuVal != null && gpuVal > 0) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + gpuVal + '</div><div class="env-metric-lbl">GPU</div></div>';
      if (maxRunStr != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + maxRunStr + '</div><div class="env-metric-lbl">MAX RUN</div></div>';

      let html = '<span class="label-section">SELECTED ENVIRONMENT</span>';
      if (subLine) html += '<div class="env-node-sub">' + subLine + '</div>';
      if (cells) html += '<div class="env-metric-grid">' + cells + '</div>';
      defaultEnvBody.innerHTML = html;
    }

    function renderProject() {
      if (projectPath) {
        // Full path; CSS left-truncates (ellipsis at start) so as much of the
        // tail as fits is shown, with the folder name always visible.
        projectPathEl.textContent = projectPath;
        projectPathEl.classList.remove('empty');
        projectPathEl.title = projectPath;
      } else {
        projectPathEl.textContent = 'No folder selected';
        projectPathEl.classList.add('empty');
        projectPathEl.removeAttribute('title');
      }
    }

    function renderDockerFields() {
      if (projectType === DOCKER_PROJECT_TYPE) {
        dockerFields.classList.add('visible');
      } else {
        dockerFields.classList.remove('visible');
      }
    }

    function renderEnvCard() {
      if (mode === 'connected-paid' && connected) {
        envCard.classList.add('visible');
        let cpuVal = null, ramVal = null, diskVal = null, gpuVal = null;
        if (jobSummary?.resources && jobSummary.resources.length > 0) {
          for (const r of jobSummary.resources) {
            if (!r.id) continue;
            if (r.id.includes('cpu')) cpuVal = r.amount;
            else if (r.id.includes('ram')) ramVal = r.amount;
            else if (r.id.includes('disk')) diskVal = r.amount;
            // Anything else is a GPU (GPU resource ids are model/uuid, not 'gpu')
            else gpuVal = (gpuVal || 0) + r.amount;
          }
        }
        // Available maxes from the env (selected / available, X/Y).
        const maxById = {};
        (envInfo.available || []).forEach((r) => {
          if (!r.id) return;
          if (r.id.includes('cpu')) maxById.cpu = r.max;
          else if (r.id.includes('ram')) maxById.ram = r.max;
          else if (r.id.includes('disk')) maxById.disk = r.max;
          else maxById.gpu = (maxById.gpu || 0) + r.max;
        });
        let maxRunStr = null;
        if (jobSummary?.duration) {
          const s = Number(jobSummary.duration);
          if (s >= 3600) maxRunStr = Math.round(s / 3600) + 'h';
          else if (s >= 60) maxRunStr = Math.round(s / 60) + 'm';
          else maxRunStr = s + 's';
        }
        // Selected value stays prominent; "/ max" is a small muted suffix.
        const metricCell = (sel, max, unit, label) => {
          const u = unit ? ' ' + unit : '';
          const val = max != null
            ? sel + '<span class="mv-max">/ ' + max + u + '</span>'
            : sel + u;
          return '<div class="env-metric-cell"><div class="env-metric-val">' + val + '</div><div class="env-metric-lbl">' + label + '</div></div>';
        };
        let cells = '';
        if (cpuVal != null) cells += metricCell(cpuVal, maxById.cpu, '', 'CPU');
        if (ramVal != null) cells += metricCell(ramVal, maxById.ram, 'GB', 'RAM');
        if (diskVal != null) cells += metricCell(diskVal, maxById.disk, 'GB', 'DISK');
        if (gpuVal != null && gpuVal > 0) cells += metricCell(gpuVal, maxById.gpu, '', 'GPU');
        if (maxRunStr != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + maxRunStr + '</div><div class="env-metric-lbl">MAX RUN</div></div>';
        envResources.innerHTML = cells ? '<div class="env-metric-grid">' + cells + '</div>' : '';

        const hasMax = maxById.cpu != null || maxById.ram != null || maxById.disk != null || maxById.gpu != null;
        envHint.textContent = hasMax ? 'selected / available' : '';

        const sym = envInfo.symbol || '';
        if (envInfo.loading) {
          envCostEl.textContent = 'Est. cost · loading…';
          envBalanceEl.textContent = 'Escrow · loading…';
        } else {
          envCostEl.textContent =
            envInfo.cost != null ? 'Est. cost ≈ ' + envInfo.cost.toFixed(4) + ' ' + sym + ' / run' : 'Est. cost unavailable';
          envBalanceEl.textContent =
            envInfo.balance != null ? 'Escrow ' + envInfo.balance.toFixed(4) + ' ' + sym : 'Escrow unavailable';
        }
      } else {
        envCard.classList.remove('visible');
      }
    }

    function renderJobActions() {
      const selectedJob = selectedJobId ? jobs.find((j) => j.jobId === selectedJobId) : null;
      const effStatus = selectedJob
        ? (selectedJob.jobId === runningJobId ? 'Running' : (selectedJob.status || 'Queued'))
        : null;

      // Download: enabled only when the selected job is Completed or has outputsURL.
      // (Stop lives on the primary Run button, in place, while a job runs.)
      const canDownload = selectedJob && (effStatus === 'Completed' || !!selectedJob.outputsURL);
      downloadBtn.disabled = !canDownload;
    }

    function renderRunBtn() {
      const hasProject = !!projectPath;
      if (runningJobId) {
        // A job is running — the primary button becomes Stop, in place.
        runBtn.textContent = '\\u25A0 Stop job';
        runBtn.classList.add('btn-danger');
        runBtn.disabled = false;
      } else {
        runBtn.classList.remove('btn-danger');
        runBtn.textContent =
          mode === 'connected-paid'
            ? (connectedFree ? '\\u25BA Run free job' : '\\u25BA Run job')
            : '\\u25BA Run free test job';
        runBtn.disabled = !hasProject;
      }
    }

    function renderTimer() {
      if (isRunning) {
        elapsedTimerEl.style.display = 'block';
        elapsedTimerEl.textContent = fmtElapsed(elapsedSeconds) + ' elapsed';
      } else {
        elapsedTimerEl.style.display = 'none';
      }
    }

    function renderJobs() {
      if (!jobs || jobs.length === 0) {
        jobsListEl.innerHTML = '<div class="no-jobs">No jobs yet</div>';
        return;
      }
      // The actively-running job (this session) shows as Running even before the
      // incentive backend reflects it.
      const effStatus = (j) => (j.jobId === runningJobId ? 'Running' : (j.status || 'Queued'));
      // Running job pinned top
      const sorted = [...jobs].sort((a, b) => {
        const ar = effStatus(a) === 'Running', br = effStatus(b) === 'Running';
        if (ar && !br) return -1;
        if (br && !ar) return 1;
        return toMs(b.createdAt) - toMs(a.createdAt);
      });
      if (jobsShown < JOBS_PAGE) jobsShown = JOBS_PAGE;
      const visible = sorted.slice(0, jobsShown);
      let html = visible.map((j) => {
        const sel = j.jobId === selectedJobId ? ' selected' : '';
        const status = effStatus(j);
        const sc = statusClass(status);
        const shortName = j.name && j.name !== j.jobId
          ? j.name
          : j.jobId.slice(0, 8) + '…';
        const timeStr = fmtTime(j.finishedAt || j.createdAt);
        return (
          '<div class="job-row' + sel + '" data-id="' + j.jobId + '">' +
          '<span class="status-dot ' + sc + '"></span>' +
          '<span class="job-name" title="' + (j.name || j.jobId) + '">' + shortName + '</span>' +
          '<span class="status-badge ' + sc + '">' + status + '</span>' +
          '<span class="job-time">' + timeStr + '</span>' +
          '</div>'
        );
      }).join('');
      const remaining = sorted.length - visible.length;
      if (remaining > 0) {
        html += '<button id="jobsMoreBtn" class="btn btn-sm btn-ghost" style="width:100%;margin-top:var(--sp-1);">Show ' + remaining + ' more</button>';
      }
      jobsListEl.innerHTML = html;

      // Attach click handlers: select job and switch logs to that job
      jobsListEl.querySelectorAll('.job-row').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id');
          selectedJobId = id;
          renderJobActions();
          renderJobs();
          vscode.postMessage({ type: 'selectJob', jobId: id });
          vscode.postMessage({ type: 'viewJobLogs', jobId: id });
        });
      });
      const moreBtn = document.getElementById('jobsMoreBtn');
      if (moreBtn) {
        moreBtn.addEventListener('click', () => {
          jobsShown += JOBS_PAGE;
          renderJobs();
        });
      }
    }

    function renderFooter() {
      connectLink.style.display = mode === 'default-free' ? 'block' : 'none';
    }

    function renderAll() {
      renderStatus();
      renderDefaultEnvCard();
      renderProject();
      renderDockerFields();
      renderEnvCard();
      renderJobActions();
      renderRunBtn();
      renderTimer();
      renderJobs();
      renderFooter();
    }

    // -------------------------------------------------------------------------
    // Timer management
    // -------------------------------------------------------------------------
    function startTimer() {
      elapsedSeconds = 0;
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        elapsedSeconds++;
        renderTimer();
      }, 1000);
    }

    function stopTimer() {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // -------------------------------------------------------------------------
    // Event handlers
    // -------------------------------------------------------------------------
    refreshBtn.addEventListener('click', () => {
      if (!refreshInFlight) {
        doRefresh();
      }
    });

    document.getElementById('selectFolderBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'selectProjectFolder' });
    });

    document.getElementById('newFolderBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'createNewProjectFolder' });
    });

    document.getElementById('configureJobBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openConfigureJob' });
    });

    runBtn.addEventListener('click', () => {
      if (runningJobId) {
        vscode.postMessage({ type: 'stopJob' });
        return;
      }
      const showDocker = projectType === DOCKER_PROJECT_TYPE;
      const runMsg = {
        type: mode === 'connected-paid' ? 'runJob' : 'runFreeJob',
        jobName: jobNameInput.value.trim() || undefined,
        dockerImage: showDocker ? (dockerImageInput.value.trim() || undefined) : undefined,
        dockerTag: showDocker ? (dockerTagInput.value.trim() || undefined) : undefined
      };
      vscode.postMessage(runMsg);
    });

    downloadBtn.addEventListener('click', () => {
      if (!selectedJobId) return;
      const selectedJob = jobs.find((j) => j.jobId === selectedJobId);
      vscode.postMessage({
        type: 'downloadResults',
        jobId: selectedJobId,
        outputsURL: selectedJob?.outputsURL || undefined
      });
    });

    connectLink.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'connect' });
    });

    storageLink.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openStorage' });
    });

    // -------------------------------------------------------------------------
    // Message handler
    // -------------------------------------------------------------------------
    window.addEventListener('message', (event) => {
      const msg = event.data;
      console.log('Sidebar received:', msg.type);

      switch (msg.type) {
        case 'stateUpdate':
          mode = msg.mode || 'default-free';
          connected = msg.status?.connected || false;
          nodeId = msg.status?.nodeId || null;
          walletAddress = msg.status?.address || null;
          connectedFree = !!msg.status?.isFree;
          jobSummary = msg.jobSummary || null;
          if (msg.project) {
            projectPath = msg.project.folderPath || projectPath;
          }
          // Stop retry loop when switching to connected-paid
          if (mode === 'connected-paid') {
            stopRetryLoop();
            connStatus = 'connected';
          }
          renderAll();
          // Request job refresh on state change
          vscode.postMessage({ type: 'getJobs' });
          // Fetch default env capabilities when in default-free mode
          if (mode === 'default-free' && !defaultEnvRequested) {
            defaultEnvRequested = true;
            connStatus = 'connecting';
            vscode.postMessage({ type: 'getDefaultEnv' });
          }
          break;

        case 'defaultEnvLoaded':
          if (msg.error) {
            defaultEnv = false;
            connStatus = 'failed';
            setRefreshInFlight(false);
            renderStatus();
            renderDefaultEnvCard();
            // Start the 5s retry loop (no-op if already running)
            if (mode === 'default-free') {
              startRetryLoop();
            }
          } else {
            defaultEnv = msg.env || false;
            connStatus = 'connected';
            setRefreshInFlight(false);
            // Stop the retry loop — env loaded successfully
            stopRetryLoop();
            renderStatus();
            renderDefaultEnvCard();
          }
          break;

        case 'defaultJobName':
          // Force after a run (fresh name for the next job); otherwise only prefill empty.
          if (msg.force || !jobNameInput.value.trim()) {
            jobNameInput.value = msg.name || '';
          }
          break;

        case 'projectFolder':
          projectPath = msg.path;
          projectType = msg.projectType || null;
          algorithmPath = msg.algorithmPath || (msg.path + '/' + msg.algorithmFileName);
          resultsFolderPath = msg.path + '/results';
          renderProject();
          renderDockerFields();
          renderRunBtn();
          break;

        case 'projectCreated':
          projectPath = msg.projectPath;
          projectType = msg.language || null;
          algorithmPath = msg.algorithmPath;
          resultsFolderPath = msg.resultsPath;
          renderProject();
          renderDockerFields();
          renderRunBtn();
          break;

        case 'envInfo':
          if (msg.loading) {
            envInfo = { ...envInfo, loading: true };
          } else {
            envInfo = { cost: msg.cost, balance: msg.balance, symbol: msg.symbol, available: msg.available || [], loading: false };
          }
          renderEnvCard();
          break;

        case 'jobsLoaded':
          jobs = msg.jobs || [];
          selectedJobId = msg.selectedJobId !== undefined ? msg.selectedJobId : selectedJobId;
          // In connected-paid mode the env card is hidden; jobs response signals refresh done
          if (mode === 'connected-paid' && refreshInFlight) {
            setRefreshInFlight(false);
          }
          renderJobActions();
          renderJobs();
          break;

        case 'jobLoading':
          // Disable run btn while submitting
          runBtn.disabled = true;
          break;

        case 'jobStarted':
          isRunning = true;
          runningJobId = msg.jobId || null;
          // Auto-select the started job so Stop/logs appear immediately
          if (runningJobId) {
            selectedJobId = runningJobId;
            vscode.postMessage({ type: 'selectJob', jobId: runningJobId });
            vscode.postMessage({ type: 'viewJobLogs', jobId: runningJobId });
          }
          startTimer();
          renderStatus();
          renderRunBtn();
          renderTimer();
          // Refresh so the just-started job appears immediately
          vscode.postMessage({ type: 'getJobs' });
          break;

        case 'jobRunning':
          isRunning = true;
          if (msg.elapsed != null) {
            elapsedSeconds = msg.elapsed;
            renderTimer();
          }
          break;

        case 'jobStopped':
          isRunning = false;
          runningJobId = null;
          stopTimer();
          renderStatus();
          renderRunBtn();
          renderTimer();
          renderJobActions();
          // Refresh job list
          vscode.postMessage({ type: 'getJobs' });
          break;

        case 'jobCompleted':
          isRunning = false;
          runningJobId = null;
          stopTimer();
          renderStatus();
          renderRunBtn();
          renderTimer();
          renderJobActions();
          // Refresh job list
          vscode.postMessage({ type: 'getJobs' });
          break;

        // Legacy compat — ignore remaining old message types gracefully
        default:
          break;
      }
    });

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    // connStatus starts as 'connecting'; updated by defaultEnvLoaded / stateUpdate
    renderAll();
    vscode.postMessage({ type: 'getState' });
    vscode.postMessage({ type: 'getJobs' });
    // Request default env capabilities on first load (default-free mode)
    if (mode === 'default-free') {
      defaultEnvRequested = true;
      connStatus = 'connecting';
      vscode.postMessage({ type: 'getDefaultEnv' });
    }
  </script>
</body>
</html>`
  }
}
