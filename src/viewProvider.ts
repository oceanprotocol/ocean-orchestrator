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
import { DEFAULT_MULTIADDR } from './helpers/p2p'

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
      this._view.webview.postMessage({
        type: 'configUpdate',
        config
      })
    }
  }

  public sendMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message)
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
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log('resolveWebviewView called')

    try {
      this._view = webviewView

      webviewView.webview.options = {
        enableScripts: true
      }

      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

      webviewView.webview.onDidReceiveMessage(async (data) => {
        console.log('Received message from webview:', data)

        try {
          switch (data.type) {
            case 'validateDatasetFromInput':
              const isValid = await vscode.commands.executeCommand(
                'ocean-protocol.validateDataset',
                data.input
              )
              webviewView.webview.postMessage({
                type: 'datasetValidationResult',
                isValid: isValid
              })
              break
            case 'getEnvironments':
              try {
                const environments = await vscode.commands.executeCommand(
                  'ocean-protocol.getEnvironments'
                )
                webviewView.webview.postMessage({
                  type: 'environmentsLoaded',
                  environments: environments
                })
              } catch (error) {
                console.error('Error loading environments:', error)
                webviewView.webview.postMessage({
                  type: 'environmentsLoaded',
                  environments: [],
                  error: 'Failed to load compute environments'
                })
              }
              break
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

                webviewView.webview.postMessage({
                  type: 'projectFolder',
                  path: folderUri[0].fsPath,
                  projectType: projectType,
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
                  // Show language selection dialog
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

                      webviewView.webview.postMessage({
                        type: 'projectCreated',
                        projectPath: projectPath,
                        algorithmPath: path.join(
                          projectPath,
                          templates.algorithmFileName
                        ),
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
            case 'startComputeJob':
              console.log('Starting compute job with data:', data)
              await vscode.commands.executeCommand(
                'ocean-protocol.startComputeJob',
                data.algorithmPath,
                data.resultsFolderPath,
                data.authToken,
                data.datasetPath,
                data.dockerImage,
                data.dockerTag,
                data.environmentId,
                data.outputBucketId
              )
              break
            case 'stopComputeJob':
              await vscode.commands.executeCommand(
                'ocean-protocol.stopComputeJob',
                data.authToken
              )
              break
            case 'downloadResults':
              await vscode.commands.executeCommand(
                'ocean-protocol.downloadResults',
                data.jobId
              )
              break
            case 'openResultsFolder':
              vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(data.path))
              break
            case 'copyToClipboard':
              vscode.env.clipboard.writeText(data.text)
              break
            case 'openExternalUrl':
              vscode.env.openExternal(vscode.Uri.parse(data.url))
              break
            case 'openStoragePanel':
              vscode.commands.executeCommand('ocean-protocol.openStoragePanel')
              break
            case 'openBrowser':
              this.trackFn?.('configure_compute_clicked')
              const appName = vscode.env?.appName || 'vscode'
              const multiaddrsParam = (
                this.config?.multiaddresses ?? [this.defaultMultiaddr]
              ).join(',')
              vscode.env.openExternal(
                vscode.Uri.parse(
                  `${data.url}?ide=${appName?.toLowerCase()}&isFreeCompute=${this.config?.isFreeCompute || true}&multiaddresses=${encodeURIComponent(multiaddrsParam)}`
                )
              )
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
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>Ocean Orchestrator</title>
        <style>
          body { 
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
          }
          .container {
            padding: 0 20px;
          }
          input, button {
            margin: 5px 0;
            width: 100%;
            padding: 8px;
            box-sizing: border-box;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          label {
            margin-top: 10px;
            display: block;
          }
          .selectedFile {
            margin-top: 5px;
          }
          .filePath {
            font-style: italic;
            display: block;
            margin-top: 5px;
            color: var(--vscode-foreground);
          }
          .filePrefix {
            font-style: normal;
            font-weight: bold;
            font-size: 1.1em;
            display: block;
            color: var(--vscode-descriptionForeground);
          }
          #selectedProjectPath {
            margin: 10px 0;
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
          }
          .currentFile {
            margin-top: 5px;
            font-style: normal;
          }
          .section {
            margin-bottom: 10px;
          }
          .section-header {
            background-color: var(--vscode-sideBarSectionHeader-background);
            color: var(--vscode-sideBarSectionHeader-foreground);
            padding: 10px 20px;
            cursor: pointer;
            user-select: none;
            font-weight: bold;
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            display: flex;
            align-items: center;
          }
          .section-content {
            padding: 10px 0;
            display: none;
          }
          .section-content.active {
            display: block;
          }
          .section-header:hover {
            background-color: var(--vscode-sideBarSectionHeader-hoverBackground);
          }
          .chevron {
            margin-right: 5px;
            transition: transform 0.3s ease;
          }
          .section-header.active .chevron {
            transform: rotate(90deg);
          }
          .compute-container {
            padding: 15px 20px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
          }
          #startComputeBtn {
            margin: 5px 0;
          }
          #configureCompute {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
            cursor: pointer;
            padding: 8px;
            margin: 5px 0;
            width: 100%;
            font-size: var(--vscode-font-size);
            text-decoration: none;
          }
          #configureCompute:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
          #datasetInput, #outputBucketInput {
            width: 100%;
            padding: 8px;
          }
          #mountedBadge {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin: 4px 0 6px;
            word-break: break-all;
          }
          #mountedBadge.has-mounts {
            color: var(--vscode-foreground);
          }
          #stopComputeBtn {
            margin: 5px 0;
          }
          .environment-section {
            margin: 6px 0;
          }
          .environment-select {
            width: 100%;
            padding: 8px;
            margin: 5px 0;
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
          }
          .environment-details {
            margin-top: 6px;
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 0.9em;
            display: none;
          }
          .environment-details.active {
            display: block;
          }
          .environment-details p {
            margin: 5px 0;
          }
          .environment-details .label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
          }
          .env-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--vscode-descriptionForeground);
          }
          .env-loading-spinner {
            width: 18px;
            height: 18px;
            border: 2px solid var(--vscode-input-border);
            border-top-color: var(--vscode-focusBorder);
            border-radius: 50%;
            animation: env-spin 0.8s linear infinite;
          }
          @keyframes env-spin {
            to { transform: rotate(360deg); }
          }
          .error-message {
            color: var(--vscode-errorForeground);
            font-size: 0.9em;
            display: none;
          }
          .section-separator {
            border: none;
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
            margin: 10px 0 6px 0;
          }
          .section-label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
            display: block;
          }
          .hint-text {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 6px;
          }
          .hint-text a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
          }
          .hint-text a:hover {
            text-decoration: underline;
          }
        </style>
    </head>
    <body>
          <div class="container">
              <div id="selectedProjectPath" class="selectedFile">
                <span class="filePrefix">Selected project folder: </span>
                <span class="filePath">Please create or select a project folder</span>
              </div>
              <div></div>
              <button id="startComputeBtn">Run <strong>Test</strong> Job</button>
              <button id="stopComputeBtn" style="display: none;">Stop Job</button>
              <div id="errorMessage" class="error-message"></div>
              <button id="createNewProjectBtn">Create New Project Folder</button>

              <button id="selectProjectFolderBtn">Select Project Folder</button>
              <button id="configureCompute">Configure Compute ⚙️</button>
              <button id="openStorageBtn" disabled style="opacity:0.6;">Configure Persistent Storage</button>
              <input id="datasetInput" placeholder="Dataset URL/IPFS/Arweave/DID" />
              <input id="outputBucketInput" placeholder="Output bucket ID (optional)" />
              <div id="mountedBadge">No persistent datasets mounted</div>

              <hr class="section-separator" />
              <select id="jobSelect" class="environment-select" disabled>
                <option value="">No jobs yet</option>
              </select>
              <button id="downloadResultsBtn" disabled style="opacity: 0.8;">Download Results</button>
              <p class="hint-text">
                More job results can be found 
                <a id="openConsumerDashboardLink" href="#">here</a>.
              </p>
          </div>

          <div class="section">
              <div id="setupHeader" class="section-header">
                  <span class="chevron">&#9658;</span>Setup
              </div>
              <div id="setup" class="section-content">
                  <div class="container">

                      <div class="environment-section">
                        <button id="checkConnectionBtn">Check connection</button>
                        <div id="environmentDetails" class="environment-details"></div>
                      </div>

                      <div style="margin: 5px 0; font-size: 0.85em; color: var(--vscode-descriptionForeground); font-style: italic;">
                        *Dockerfile in project root takes priority
                      </div>
                      
                      <label for="dockerImageInput">Docker Image (optional)</label>
                      <input id="dockerImageInput" placeholder="Enter custom Docker image name" />

                      <label for="dockerTagInput">Docker Tag (optional)</label>
                      <input id="dockerTagInput" placeholder="Enter custom Docker tag" />
                  </div>
              </div>
          </div>

          <script>
              const vscode = acquireVsCodeApi();
              const defaultMultiaddr = "${this.defaultMultiaddr.replace(/"/g, '\\"')}";
              let selectedProjectPath = '';
              let selectedAlgorithmPath = '';
              let selectedResultsFolderPath = '';
              let availableEnvironments = [];
              let sessionJobIds = [];
              let configResources = null;
              let jobDuration = null;
              let isFreeCompute = true; // Default to free compute
              let storedAuthToken = null;
              let storedEnvironmentId = null;
              let storedMultiaddrs = null;
              let mountedEntries = [];

              function renderMountedBadge() {
                const el = document.getElementById('mountedBadge');
                if (!el) return;
                if (!mountedEntries.length) {
                  el.className = '';
                  el.textContent = 'No persistent datasets mounted';
                  return;
                }
                el.className = 'has-mounts';
                const labels = mountedEntries.map((e) => {
                  const short = e.bucketId.length > 12 ? e.bucketId.slice(0, 6) + '…' : e.bucketId;
                  return short + '/' + e.fileName;
                });
                el.textContent = mountedEntries.length + ' mounted: ' + labels.join(', ');
              }

              // --- Storage button state ---
              let isNodeConnected = false;

              function updateStorageButtonState() {
                const btn = document.getElementById('openStorageBtn');
                if (!btn) return;
                const enabled = isNodeConnected && !!storedAuthToken;
                btn.disabled = !enabled;
                btn.style.opacity = enabled ? '1' : '0.6';
                btn.title = enabled
                  ? 'Manage persistent storage buckets'
                  : 'Connect to a node via the dashboard to enable';
              }

              if (document.getElementById('openStorageBtn')) {
                document.getElementById('openStorageBtn').addEventListener('click', () => {
                  vscode.postMessage({ type: 'openStoragePanel' });
                });
              }

              function getMultiaddrs() { return storedMultiaddrs || [defaultMultiaddr]; }
              function truncateMultiaddr(addr) {
                  if (!addr) return 'N/A';
                  return addr.length > 40 ? addr.substring(0, 20) + '...' + addr.substring(addr.length - 12) : addr;
              }


              const environmentDetails = document.getElementById('environmentDetails');

              function toggleSection(sectionId) {
                  const header = document.getElementById(sectionId + 'Header');
                  const content = document.getElementById(sectionId);
                  header.classList.toggle('active');
                  content.classList.toggle('active');
              }

              // Initialize only the setup section toggle
              document.getElementById('setupHeader').addEventListener('click', () => toggleSection('setup'));

              if (document.getElementById('createNewProjectBtn')) {
                  document.getElementById('createNewProjectBtn').addEventListener('click', () => {
                      console.log('Create new project button clicked');
                      vscode.postMessage({ 
                          type: 'createNewProjectFolder'
                      });
                  });
              }

              if (document.getElementById('selectProjectFolderBtn')) {
                  document.getElementById('selectProjectFolderBtn').addEventListener('click', () => {
                      console.log('Select project folder button clicked');
                      vscode.postMessage({
                          type: 'selectProjectFolder' 
                      });
                  });
              }

              if (document.getElementById('checkConnectionBtn')) {
                  document.getElementById('checkConnectionBtn').addEventListener('click', () => loadEnvironments());
              }

              if (document.getElementById('datasetInput')) {
                document.getElementById('datasetInput').addEventListener('input', (e) => {
                  const input = e.target.value.trim();
                  const validationIcon = document.getElementById('datasetValidationIcon');
                  
                  if (!input) {
                    validationIcon.textContent = '';
                    document.getElementById('errorMessage').style.display = 'none';
                    return;
                  }

                  console.log('Dataset input changed:', input);
                  vscode.postMessage({
                    type: 'validateDatasetFromInput',
                    input: input
                  });
                });
              }

              function setDownloadBtnState(enabled) {
                  const btn = document.getElementById('downloadResultsBtn');
                  btn.disabled = !enabled;
                  btn.style.opacity = enabled ? '1' : '0.8';
              }

              // Toggle button visibility
              function showStartButton() {
                  document.getElementById('startComputeBtn').style.display = 'block';
                  document.getElementById('stopComputeBtn').style.display = 'none';
                  // Reset button state
                  document.getElementById('startComputeBtn').disabled = false;
                  document.getElementById('startComputeBtn').style.opacity = '1';
              }

              function showStopButton() {
                  document.getElementById('startComputeBtn').style.display = 'none';
                  document.getElementById('stopComputeBtn').style.display = 'block';
              }

              function disableStartButton() {
                document.getElementById('startComputeBtn').disabled = true;
                document.getElementById('startComputeBtn').style.opacity = '0.8';
              }

              if (document.getElementById('startComputeBtn')) {
                  document.getElementById('startComputeBtn').addEventListener('click', () => {
                      const dockerImage = document.getElementById('dockerImageInput').value;
                      const dockerTag = document.getElementById('dockerTagInput').value;
                      const errorMessage = document.getElementById('errorMessage');
                      const environmentId = storedEnvironmentId || (availableEnvironments.length > 0 ? availableEnvironments[0].id : undefined);
                      
                      if (!selectedProjectPath) {
                          errorMessage.textContent = 'Please create or select a project folder';
                          errorMessage.style.display = 'block';
                          return;
                      }

                      let algorithmPath = selectedAlgorithmPath;
                      let resultsFolderPath = selectedResultsFolderPath;
                      
                      if (!algorithmPath || !resultsFolderPath) {
                          errorMessage.textContent = 'Project folder must contain an algorithm file and results folder';
                          errorMessage.style.display = 'block';
                          return;
                      }

                      // Clear any previous error
                      errorMessage.style.display = 'none';

                      // Start compute job directly
                      vscode.postMessage({
                          type: 'startComputeJob',
                          authToken: storedAuthToken,
                          algorithmPath: algorithmPath,
                          resultsFolderPath: resultsFolderPath,
                          datasetPath: document.getElementById('datasetInput').value || undefined,
                          dockerImage: dockerImage || undefined,
                          dockerTag: dockerTag || undefined,
                          environmentId: environmentId,
                          outputBucketId: document.getElementById('outputBucketInput')?.value || undefined
                      });
                  });
              }

              if (document.getElementById('configureCompute')) {
                  document.getElementById('configureCompute').addEventListener('click', () => {
                      vscode.postMessage({ 
                          type: 'openBrowser',
                          url: 'https://dashboard.oncompute.ai/run-job/environments'
                      });
                  });
              }

              if (document.getElementById('stopComputeBtn')) {
                  document.getElementById('stopComputeBtn').addEventListener('click', () => {
                      vscode.postMessage({ type: 'stopComputeJob', authToken: storedAuthToken });
                  });
              }

              document.getElementById('downloadResultsBtn').addEventListener('click', () => {
                  const jobId = document.getElementById('jobSelect').value;
                  if (!jobId) return;
                  vscode.postMessage({ type: 'downloadResults', jobId });
              });

              document.getElementById('openConsumerDashboardLink').addEventListener('click', (e) => {
                  e.preventDefault();
                  vscode.postMessage({ type: 'openExternalUrl', url: 'https://dashboard.oncompute.ai/profile/consumer' });
              });

              function showEnvironmentsLoading() {
                const detailsDiv = document.getElementById('environmentDetails');
                if (!detailsDiv) return;
                detailsDiv.innerHTML = 
                  '<div class="env-loading">' +
                  '<div class="env-loading-spinner"></div>' +
                  '<span>Checking connection...</span>' +
                  '</div>';
                detailsDiv.style.display = 'block';
              }

              function loadEnvironments() {
                showEnvironmentsLoading();
                try {
                  vscode.postMessage({
                    type: 'getEnvironments'
                  });
                } catch (error) {
                  console.error('Error loading environments:', error);
                  document.getElementById('environmentDetails').innerHTML = 
                    '<p style="color: var(--vscode-errorForeground);">Failed to check connection</p>';
                  disableStartButton();
                }
              }
              
              // Disable start button initially until node is validated and project is selected
              disableStartButton();
              
              // Load environments on page load
              loadEnvironments();
              updateStorageButtonState();
              
              function checkStartButtonState() {
                  const hasProject = selectedProjectPath && selectedProjectPath.trim() !== '';
                  const hasEnvironments = availableEnvironments && availableEnvironments.length > 0;
                  
                  if (hasProject && hasEnvironments) {
                      document.getElementById('startComputeBtn').disabled = false;
                      document.getElementById('startComputeBtn').style.opacity = '1';
                  } else {
                      document.getElementById('startComputeBtn').disabled = true;
                      document.getElementById('startComputeBtn').style.opacity = '0.8';
                  }
              }

              function showEnvDetails(envId) {
                  const detailsDiv = document.getElementById('environmentDetails');
                  const selectedEnv = availableEnvironments.find(e => e.id === envId);
                  if (!selectedEnv || !detailsDiv) {
                      if (detailsDiv) detailsDiv.style.display = 'none';
                      return;
                  }
                  function formatResourceValue(amount, resourceId) {
                      if (resourceId === 'ram' || resourceId === 'disk') return Math.round(amount) + ' GB';
                      return amount;
                  }
                  function getAvailableValue(resourceId, isFreeCompute) {
                      const resources = isFreeCompute ? (selectedEnv.free?.resources || []) : (selectedEnv.resources || []);
                      const envResource = resources.find(r => r.id === resourceId);
                      return envResource ? formatResourceValue((envResource.max || 0) - (envResource.inUse || 0), resourceId) : 'N/A';
                  }
                  const truncatedId = selectedEnv.id.length > 13 
                      ? selectedEnv.id.substring(0, 6) + '...' + selectedEnv.id.substring(selectedEnv.id.length - 4)
                      : selectedEnv.id;
                  let resourceDetails = '';
                  let resourcesLabel = 'Resources:';
                  resourcesLabel = 'Resources (SELECTED / AVAILABLE):';
                  resourceDetails = (configResources || []).map(r => {
                      const selectedValue = formatResourceValue(r.amount, r.id);
                      const availableValue = getAvailableValue(r.id, isFreeCompute);
                      return '<p style="margin: 4px 0;"><span class="label">' + r.id.toUpperCase() + ':</span> ' + selectedValue + ' / ' + availableValue + '</p>';
                  }).join('');
                  resourceDetails += '<p style="margin: 4px 0;"><span class="label">Job Duration:</span> ' + (jobDuration || 'N/A') + ' seconds</p>';
                  const multiaddrDisplay = truncateMultiaddr(getMultiaddrs()[0]);
                  detailsDiv.innerHTML = 
                      '<p style="margin: 4px 0;"><span class="label">Multiaddress:</span> ' + multiaddrDisplay + '</p>' +
                      '<p><span class="label">Environment ID:</span> ' + truncatedId + '</p>' +
                      '<p><span class="label">OS:</span> ' + (selectedEnv.platform?.os ?? 'N/A') + '</p>' +
                      '<p><span class="label">Architecture:</span> ' + (selectedEnv.platform?.architecture ?? 'N/A') + '</p>' +
                      '<div style="margin: 4px 0;">' +
                      '<div class="label" style="margin-bottom: 2px;">Consumer Address:</div>' +
                      '<div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-input-background); padding: 4px; border-radius: 4px;">' +
                      '<span style="font-family: monospace; flex-grow: 1; overflow-x: auto; white-space: nowrap;">' + 
                      (selectedEnv.consumerAddress.length > 24 
                          ? selectedEnv.consumerAddress.substring(0, 12) + '...' + selectedEnv.consumerAddress.substring(selectedEnv.consumerAddress.length - 8)
                          : selectedEnv.consumerAddress) + 
                      '</span>' +
                      '<button id="copyAddressBtn" style="padding: 2px 8px; margin: 0; width: auto; min-width: 60px; font-size: 0.9em;">Copy</button>' +
                      '</div></div>' +
                      '<p><span class="label">' + resourcesLabel + '</span></p>' +
                      '<div style="margin-left: 8px;">' + resourceDetails + '</div>';
                  detailsDiv.style.display = 'block';
                  const copyBtn = document.getElementById('copyAddressBtn');
                  if (copyBtn) {
                      copyBtn.addEventListener('click', () => {
                          vscode.postMessage({ type: 'copyToClipboard', text: selectedEnv.consumerAddress });
                          copyBtn.textContent = 'Copied!';
                          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
                      });
                  }
              }

              window.addEventListener('message', event => {
                  const message = event.data;
                  console.log('Received message:', message);
                  
                  switch (message.type) {
                      case 'configUpdate':
                          if (message.config.authToken) {
                              storedAuthToken = message.config.authToken;
                              updateStorageButtonState();
                          }
                          let didReloadEnvironments = false;
                          if (message.config.multiaddresses !== undefined) {
                              storedMultiaddrs = message.config.multiaddresses;
                              showEnvironmentsLoading();
                              loadEnvironments();
                              didReloadEnvironments = true;
                          }
                          if (message.config.environmentId) {
                              storedEnvironmentId = message.config.environmentId;
                              if (!didReloadEnvironments && message.config.environmentId && availableEnvironments.length > 0) {
                                showEnvDetails(message.config.environmentId);
                              }
                          }
                          if (message.config.resources) {
                            configResources = message.config.resources;
                            jobDuration = message.config.jobDuration;
                            const envId = storedEnvironmentId || (availableEnvironments.length > 0 ? availableEnvironments[0].id : null);
                            if (envId && !didReloadEnvironments) {
                              showEnvDetails(envId);
                            }
                          }
                          if (message.config.isFreeCompute !== undefined) {
                            isFreeCompute = message.config.isFreeCompute;
                            const startComputeBtn = document.getElementById('startComputeBtn');
                            if (startComputeBtn) {
                              startComputeBtn.innerHTML = message.config.isFreeCompute === true 
                                ? 'Run <strong>Test</strong> Job'
                                : 'Run <strong>Compute</strong> Job';
                            }
                          }
                          break;
                      case 'projectFolder':
                          selectedProjectPath = message.path;
                          const projectElement = document.getElementById('selectedProjectPath');
                          const projectType = message.projectType;
                          const typeInfo = projectType ? ' (' + projectType + ')' : '';
                          projectElement.innerHTML = '<span class="filePrefix">Selected project folder: </span><span class="filePath">' + message.path + typeInfo + '</span>';
                          
                          selectedAlgorithmPath = message.path + '/' + message.algorithmFileName;
                          selectedResultsFolderPath = message.path + '/results';
                          
                          checkStartButtonState();
                          break;
                      case 'projectCreated':
                          selectedProjectPath = message.projectPath;
                          selectedAlgorithmPath = message.algorithmPath;
                          selectedResultsFolderPath = message.resultsPath;
                          
                          const projectElementCreated = document.getElementById('selectedProjectPath');
                          const languageInfo = message.language ? ' (' + message.language + ')' : '';
                          projectElementCreated.innerHTML = '<span class="filePrefix">Selected project folder: </span><span class="filePath">' + message.projectPath + languageInfo + '</span>';
                          
                          checkStartButtonState();
                          break;
                      case 'mountedUpdate':
                        mountedEntries = message.entries || [];
                        renderMountedBadge();
                        break;
                      case 'datasetValidationResult':
                        const validationIcon = document.getElementById('datasetValidationIcon');
                        if(!message.isValid) {
                          validationIcon.textContent = 'x';
                          validationIcon.style.color = 'var(--vscode-errorForeground)';
                          return
                        }
                        validationIcon.textContent = '✓';
                        validationIcon.style.color = '#4CAF50';
                        break;
                      case 'environmentsLoaded':
                          console.log('Environments loaded:', message.environments);
                          availableEnvironments = message.environments || [];
                          const detailsEl = document.getElementById('environmentDetails');

                          if (message.error) {
                            detailsEl.innerHTML = '<p style="color: var(--vscode-errorForeground);">Connection failed</p>';
                            detailsEl.style.display = 'block';
                            disableStartButton();
                            isNodeConnected = false;
                            updateStorageButtonState();
                            return;
                          }

                          if (!message.environments || message.environments.length === 0) {
                            detailsEl.innerHTML = '<p style="color: var(--vscode-descriptionForeground);">No environments available</p>';
                            detailsEl.style.display = 'block';
                            disableStartButton();
                            isNodeConnected = false;
                            updateStorageButtonState();
                            return;
                          }

                          isNodeConnected = true;
                          updateStorageButtonState();
                          checkStartButtonState();

                          const envId = storedEnvironmentId || (availableEnvironments.length > 0 ? availableEnvironments[0].id : null);
                          if (envId) {
                              showEnvDetails(envId);
                          }
                          break;

                      case 'jobLoading':
                          disableStartButton();
                          setDownloadBtnState(false);
                          break;
                      case 'jobStarted':
                          showStopButton();
                          break;
                      case 'jobStopped':
                          showStartButton();
                          setDownloadBtnState(sessionJobIds.length > 0);
                          break;
                      case 'jobCompleted': {
                          showStartButton();
                          const jobId = message.jobId;
                          if (jobId) {
                              const select = document.getElementById('jobSelect');
                              if (sessionJobIds.length === 0) select.innerHTML = '';
                              sessionJobIds.push(jobId);
                              const now = new Date();
                              const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              const label = jobId.substring(0, 8) + '.....' + jobId.slice(-6) + ' (' + time + ')';
                              const opt = document.createElement('option');
                              opt.value = jobId;
                              opt.textContent = label;
                              select.appendChild(opt);
                              select.value = jobId;
                              select.disabled = false;
                              setDownloadBtnState(true);
                          }
                          break;
                      }
                  }
              });
          </script>
    </body>
    </html>
    `
  }
}
