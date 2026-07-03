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
    private readonly trackFn?: (event: string, props?: Record<string, unknown>) => void,
    private readonly getSelectedProject?: () =>
      | { algorithmPath: string; resultsFolderPath: string }
      | undefined
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
    // A free run also generates/stores an auth token, so an auth token alone
    // does not mean "paid" — only treat it as paid when not free compute.
    const hasAuth = !!config.authToken
    const paidConnected = hasAuth && config.isFreeCompute !== true
    const mode: 'default-free' | 'connected-paid' = paidConnected
      ? 'connected-paid'
      : 'default-free'

    let nodeId: string | undefined
    if (config.environmentId) {
      const id = config.environmentId
      nodeId = id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-6) : id
    } else if (
      config.multiaddresses?.[0] &&
      config.multiaddresses[0] !== DEFAULT_MULTIADDR
    ) {
      const addr = config.multiaddresses[0]
      const parts = addr.split('/')
      const peerId = parts[parts.length - 1]
      nodeId = peerId.length > 16 ? peerId.slice(0, 8) + '…' + peerId.slice(-6) : peerId
    }

    const envId = config.environmentId
    const envShort = envId
      ? envId.length > 14
        ? envId.slice(0, 8) + '…' + envId.slice(-6)
        : envId
      : undefined

    return {
      type: 'stateUpdate',
      mode,
      status: {
        connected: hasAuth,
        nodeId,
        address: config.address,
        isFree: config.isFreeCompute
      },
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
                } catch {}

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

                      const algorithmPath = path.join(
                        projectPath,
                        templates.algorithmFileName
                      )

                      try {
                        await vscode.commands.executeCommand(
                          'revealInExplorer',
                          vscode.Uri.file(algorithmPath)
                        )
                      } catch {}

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
                data.jobId
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
                data.outputsURL,
                data.status
              )
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
              await vscode.commands.executeCommand(
                'ocean-protocol.viewJobLogs',
                data.jobId
              )
              break
            case 'openExternalUrl': {
              let parsed: vscode.Uri | undefined
              try {
                parsed = vscode.Uri.parse(String(data.url), true)
              } catch {
                parsed = undefined
              }
              if (!parsed || (parsed.scheme !== 'http' && parsed.scheme !== 'https')) {
                vscode.window.showErrorMessage('Unsupported external URL.')
                break
              }
              await vscode.env.openExternal(parsed)
              break
            }
            case 'copyToClipboard':
              vscode.env.clipboard.writeText(data.text)
              break
            case 'getDefaultEnv':
              await vscode.commands.executeCommand('ocean-protocol.loadDefaultEnv')
              break
            case 'getState': {
              if (this.config) {
                webviewView.webview.postMessage(this._buildStateUpdate(this.config))
              }
              // Re-send the restored project so the sidebar re-enables Run after
              // a reload (project lives in extension memory, not in stateUpdate).
              const proj = this.getSelectedProject?.()
              if (proj) {
                const projectPath = path.dirname(proj.algorithmPath)
                webviewView.webview.postMessage({
                  type: 'projectFolder',
                  path: projectPath,
                  projectType: await detectProjectType(projectPath),
                  algorithmPath: proj.algorithmPath,
                  algorithmFileName: path.basename(proj.algorithmPath)
                })
              }
              break
            }
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

    /* Connect CTA */
    .connect-cta {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      box-sizing: border-box;
      width: 100%;
      margin-bottom: var(--sp-3);
      padding: var(--sp-1) var(--sp-2);
      font-size: var(--fs-xs);
      border-radius: var(--radius-sm);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      background: transparent;
      text-decoration: none;
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition);
    }
    .connect-cta:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
      text-decoration: none;
    }
    .connect-cta-arrow {
      margin-left: auto;
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
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
      padding: 2px var(--sp-2);
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
      font-size: var(--fs-sm);
    }
    .job-when {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .job-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }
    .job-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer;
      transition: background var(--transition), opacity var(--transition);
    }
    .job-icon-btn svg {
      width: 15px;
      height: 15px;
      display: block;
    }
    .job-icon-btn:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    }
    .job-icon-btn:disabled {
      opacity: 0.25;
      cursor: default;
    }
    .job-icon-btn.stop {
      color: var(--vscode-errorForeground);
    }
    .job-icon-btn.stop:hover:not(:disabled) {
      background: color-mix(in srgb, var(--vscode-errorForeground) 18%, transparent);
    }
    .no-jobs {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
      padding: var(--sp-2);
      text-align: center;
    }
    .jobs-pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-2);
      margin-top: var(--sp-3);
    }
    .jobs-pager-info {
      font-size: var(--fs-xs);
      color: var(--vscode-descriptionForeground);
    }
    .jobs-pager .btn:disabled {
      opacity: 0.4;
      cursor: default;
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

  <!-- CONNECT CTA (default-free mode only) -->
  <a href="#" id="connectLink" class="connect-cta" style="display:none;">
    <span>Connect for paid environments</span>
    <span class="connect-cta-arrow">&#8599;</span>
  </a>

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

  <!-- JOBS -->
  <div class="section-gap section-sep">
    <span class="label-section">Jobs</span>
    <div class="jobs-list" id="jobsList">
      <div class="no-jobs">No jobs yet</div>
    </div>
  </div>


  <script>
    const vscode = acquireVsCodeApi();
    const defaultMultiaddr = "${defaultMultiaddrEscaped}";

    // Inline SVGs for per-row job actions — crisp at any zoom, theme-colored via
    // currentColor, and independent of glyph-font availability.
    const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7.5 11.5 12 16l4.5-4.5"/><path d="M5 20h14"/></svg>';
    const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

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
    let runningJobId = null;
    const JOBS_PAGE = 6;
    let jobsPage = 0;
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
    const connectLink = document.getElementById('connectLink');

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

    function fmtDateTime(ts) {
      const ms = toMs(ts);
      if (!ms) return '';
      const d = new Date(ms);
      const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return date + ' \\u00B7 ' + time;
    }

    // Resource id -> kind. GPU resource ids are model/uuid strings, so anything
    // that isn't cpu/ram/disk is treated as a GPU.
    function resourceKind(id) {
      const s = (id || '').toLowerCase();
      if (s.includes('cpu')) return 'cpu';
      if (s.includes('ram')) return 'ram';
      if (s.includes('disk')) return 'disk';
      return 'gpu';
    }

    function fmtDuration(sec) {
      const s = Number(sec);
      if (!s) return null;
      if (s >= 3600) return Math.round(s / 3600) + 'h';
      if (s >= 60) return Math.round(s / 60) + 'm';
      return s + 's';
    }

    // Escape values that originate from job metadata or the node/incentive API
    // before they are concatenated into innerHTML (CSP allows inline script).
    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
        switch (ch) {
          case '&': return '&amp;';
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '"': return '&quot;';
          default: return '&#39;';
        }
      });
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
          statusText.textContent = 'Node connected';
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
          const kind = resourceKind(r.id);
          if (kind === 'cpu') cpuVal = val;
          else if (kind === 'ram') ramVal = val;
          else if (kind === 'disk') diskVal = val;
          // Anything else is a GPU (GPU resource ids are model/uuid, not 'gpu')
          else if (r.id) gpuVal = (gpuVal || 0) + val;
        }
      }

      const maxRunStr = fmtDuration(defaultEnv.maxJobDuration);

      const subLine = [nodeLabel, platformStr].filter(Boolean).join(' · ');

      let cells = '';
      if (cpuVal != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + cpuVal + '</div><div class="env-metric-lbl">CPU</div></div>';
      if (ramVal != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + (fmtGB(ramVal) || ramVal) + '</div><div class="env-metric-lbl">RAM</div></div>';
      if (diskVal != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + (fmtGB(diskVal) || diskVal) + '</div><div class="env-metric-lbl">DISK</div></div>';
      if (gpuVal != null && gpuVal > 0) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + gpuVal + '</div><div class="env-metric-lbl">GPU</div></div>';
      if (maxRunStr != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + maxRunStr + '</div><div class="env-metric-lbl">MAX RUN</div></div>';

      let html = '<span class="label-section">SELECTED ENVIRONMENT</span>';
      if (subLine) html += '<div class="env-node-sub">' + escapeHtml(subLine) + '</div>';
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
        const gpuModels = {}; // description (GPU name) -> selected count
        if (jobSummary?.resources && jobSummary.resources.length > 0) {
          for (const r of jobSummary.resources) {
            if (!r.id) continue;
            const kind = resourceKind(r.id);
            if (kind === 'cpu') cpuVal = r.amount;
            else if (kind === 'ram') ramVal = r.amount;
            else if (kind === 'disk') diskVal = r.amount;
            // Anything else is a GPU (GPU resource ids are model/uuid, not 'gpu')
            else {
              gpuVal = (gpuVal || 0) + r.amount;
              if (r.amount > 0 && r.description) {
                gpuModels[r.description] = (gpuModels[r.description] || 0) + r.amount;
              }
            }
          }
        }
        // Available maxes from the env (selected / available, X/Y).
        // Use max - inUse for all resource types when live inUse data is present.
        const maxById = {};
        (envInfo.available || []).forEach((r) => {
          if (!r.id) return;
          const kind = resourceKind(r.id);
          const avail = r.inUse != null ? r.max - r.inUse : r.max;
          if (kind === 'cpu') maxById.cpu = avail;
          else if (kind === 'ram') maxById.ram = avail;
          else if (kind === 'disk') maxById.disk = avail;
          else maxById.gpu = (maxById.gpu || 0) + avail;
        });
        const maxRunStr = fmtDuration(jobSummary?.duration);
        // Selected value stays prominent; "/ max" is a small muted suffix.
        const metricCell = (sel, max, unit, label) => {
          const u = unit ? ' ' + unit : '';
          const val = max != null
            ? sel + '<span class="mv-max">/ ' + max + u + '</span>'
            : sel + u;
          return '<div class="env-metric-cell"><div class="env-metric-val">' + val + '</div><div class="env-metric-lbl">' + escapeHtml(label) + '</div></div>';
        };
        // Label the GPU cell with the actual model ("NVIDIA H200") instead of a
        // generic "GPU" when a single model is selected; fall back to "GPU" for
        // mixed models or when the name is unknown.
        const gpuNames = Object.keys(gpuModels);
        const gpuLabel = gpuNames.length === 1 ? gpuNames[0] : 'GPU';

        let cells = '';
        if (cpuVal != null) cells += metricCell(cpuVal, maxById.cpu, '', 'CPU');
        if (ramVal != null) cells += metricCell(ramVal, maxById.ram, 'GB', 'RAM');
        if (diskVal != null) cells += metricCell(diskVal, maxById.disk, 'GB', 'DISK');
        if (gpuVal != null && gpuVal > 0) cells += metricCell(gpuVal, maxById.gpu, '', gpuLabel);
        if (maxRunStr != null) cells += '<div class="env-metric-cell"><div class="env-metric-val">' + maxRunStr + '</div><div class="env-metric-lbl">MAX RUN</div></div>';
        envResources.innerHTML = cells ? '<div class="env-metric-grid">' + cells + '</div>' : '';

        const hasMax = maxById.cpu != null || maxById.ram != null || maxById.disk != null || maxById.gpu != null;
        envHint.textContent = hasMax ? 'Selected / Available' : '';

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

    // Effective status of a job: the session's running job shows as Running even
    // before the incentive backend reflects it.
    function jobEffStatus(j) {
      return j.jobId === runningJobId ? 'Running' : (j.status || 'Queued');
    }

    // The selected job, but only when it is currently Running (i.e. stoppable).
    function selectedLiveJob() {
      const j = selectedJobId ? jobs.find((x) => x.jobId === selectedJobId) : null;
      return j && jobEffStatus(j) === 'Running' ? j : null;
    }

    function renderRunBtn() {
      const hasProject = !!projectPath;
      runBtn.classList.remove('btn-danger');
      runBtn.textContent =
        mode === 'connected-paid'
          ? (connectedFree ? '\\u25BA Run free job' : '\\u25BA Run job')
          : '\\u25BA Run free test job';
      runBtn.disabled = !hasProject;
    }

    // Elapsed time for the SELECTED running job, derived from its createdAt (the
    // single source of truth) and ticked once a second while it's shown.
    function renderTimer() {
      const live = selectedLiveJob();
      if (live) {
        const secs = Math.max(0, Math.floor((Date.now() - toMs(live.createdAt)) / 1000));
        elapsedTimerEl.textContent = fmtElapsed(secs) + ' elapsed';
        elapsedTimerEl.style.display = 'block';
        if (!timerInterval) { timerInterval = setInterval(renderTimer, 1000); }
      } else {
        elapsedTimerEl.style.display = 'none';
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      }
    }

    function renderJobs() {
      if (!jobs || jobs.length === 0) {
        jobsListEl.innerHTML = '<div class="no-jobs">No jobs yet</div>';
        return;
      }
      // Running job pinned top
      const sorted = [...jobs].sort((a, b) => {
        const ar = jobEffStatus(a) === 'Running', br = jobEffStatus(b) === 'Running';
        if (ar && !br) return -1;
        if (br && !ar) return 1;
        return toMs(b.createdAt) - toMs(a.createdAt);
      });
      const totalPages = Math.max(1, Math.ceil(sorted.length / JOBS_PAGE));
      if (jobsPage > totalPages - 1) jobsPage = totalPages - 1;
      if (jobsPage < 0) jobsPage = 0;
      const start = jobsPage * JOBS_PAGE;
      const visible = sorted.slice(start, start + JOBS_PAGE);
      let html = visible.map((j) => {
        const sel = j.jobId === selectedJobId ? ' selected' : '';
        const status = jobEffStatus(j);
        const sc = statusClass(status);
        const shortName = j.name && j.name !== j.jobId
          ? j.name
          : j.jobId.slice(0, 8) + '…';
        const timeStr = fmtDateTime(j.finishedAt || j.createdAt);
        const jid = escapeHtml(j.jobId);
        const canDownload = status === 'Completed' || status === 'Failed' || !!j.outputsURL;
        const dlLabel = status === 'Failed' ? 'Download logs' : 'Download results';
        const downloadBtn =
          '<button class="job-icon-btn download" data-act="download" data-id="' + jid + '"' +
          (canDownload ? '' : ' disabled') +
          ' aria-label="' + dlLabel + '" title="' + dlLabel + '">' + ICON_DOWNLOAD + '</button>';
        const stopBtn = status === 'Running'
          ? '<button class="job-icon-btn stop" data-act="stop" data-id="' + jid + '" aria-label="Stop job" title="Stop job">' + ICON_STOP + '</button>'
          : '';
        return (
          '<div class="job-row' + sel + '" data-id="' + jid + '">' +
          '<span class="status-dot ' + sc + '"></span>' +
          '<span class="job-name" title="' + escapeHtml(j.name || j.jobId) + '">' + escapeHtml(shortName) + '</span>' +
          '<span class="job-when">' + timeStr + '</span>' +
          '<span class="job-actions">' + downloadBtn + stopBtn + '</span>' +
          '</div>'
        );
      }).join('');
      if (totalPages > 1) {
        const prevDis = jobsPage === 0 ? ' disabled' : '';
        const nextDis = jobsPage >= totalPages - 1 ? ' disabled' : '';
        html += '<div class="jobs-pager">' +
          '<button id="jobsPrevBtn" class="btn btn-sm btn-ghost"' + prevDis + '>&#8249; Prev</button>' +
          '<span class="jobs-pager-info">' + (jobsPage + 1) + ' / ' + totalPages + '</span>' +
          '<button id="jobsNextBtn" class="btn btn-sm btn-ghost"' + nextDis + '>Next &#8250;</button>' +
          '</div>';
      }
      jobsListEl.innerHTML = html;

      // Attach click handlers: select job and switch logs to that job
      jobsListEl.querySelectorAll('.job-row').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id');
          selectedJobId = id;
          renderRunBtn();
          renderTimer();
          renderJobs();
          vscode.postMessage({ type: 'selectJob', jobId: id });
          vscode.postMessage({ type: 'viewJobLogs', jobId: id });
        });
      });

      // Per-row action icons act on their own job without selecting the row.
      jobsListEl.querySelectorAll('.job-icon-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.disabled) return;
          const id = btn.getAttribute('data-id');
          if (btn.getAttribute('data-act') === 'stop') {
            vscode.postMessage({ type: 'stopJob', jobId: id });
          } else {
            const job = jobs.find((j) => j.jobId === id);
            vscode.postMessage({
              type: 'downloadResults',
              jobId: id,
              outputsURL: job?.outputsURL || undefined,
              status: job ? jobEffStatus(job) : undefined
            });
          }
        });
      });
      const prevBtn = document.getElementById('jobsPrevBtn');
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (jobsPage > 0) { jobsPage -= 1; renderJobs(); }
        });
      }
      const nextBtn = document.getElementById('jobsNextBtn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          jobsPage += 1; renderJobs();
        });
      }
    }

    function renderFooter() {
      connectLink.style.display = mode === 'default-free' ? 'flex' : 'none';
    }

    function renderAll() {
      renderStatus();
      renderDefaultEnvCard();
      renderProject();
      renderDockerFields();
      renderEnvCard();
      renderRunBtn();
      renderTimer();
      renderJobs();
      renderFooter();
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
      const showDocker = projectType === DOCKER_PROJECT_TYPE;
      const runMsg = {
        type: mode === 'connected-paid' ? 'runJob' : 'runFreeJob',
        jobName: jobNameInput.value.trim() || undefined,
        dockerImage: showDocker ? (dockerImageInput.value.trim() || undefined) : undefined,
        dockerTag: showDocker ? (dockerTagInput.value.trim() || undefined) : undefined
      };
      vscode.postMessage(runMsg);
    });

    connectLink.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'connect' });
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
          renderRunBtn();
          renderTimer();
          renderJobs();
          break;

        case 'jobLoading':
          // Disable run btn while submitting
          runBtn.disabled = true;
          break;

        case 'jobStarted':
          runningJobId = msg.jobId || null;
          jobsPage = 0;
          // Auto-select the started job so Stop/logs appear immediately
          if (runningJobId) {
            selectedJobId = runningJobId;
            vscode.postMessage({ type: 'selectJob', jobId: runningJobId });
            vscode.postMessage({ type: 'viewJobLogs', jobId: runningJobId });
          }
          renderStatus();
          renderRunBtn();
          renderTimer();
          // Refresh so the just-started job appears immediately
          vscode.postMessage({ type: 'getJobs' });
          break;

        case 'jobRunning':
          renderTimer();
          break;

        case 'jobStopped':
          runningJobId = null;
          renderStatus();
          renderRunBtn();
          renderTimer();
          // Refresh job list
          vscode.postMessage({ type: 'getJobs' });
          break;

        case 'jobCompleted':
          runningJobId = null;
          renderStatus();
          renderRunBtn();
          renderTimer();
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
