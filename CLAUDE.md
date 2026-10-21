# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ocean-protocol-vscode-extension` (display name **Ocean Orchestrator**, publisher `OceanProtocol`) — a VS Code extension (also runs in Cursor, Antigravity, Windsurf) that runs Ocean Protocol **Compute-to-Data (C2D)** jobs from the editor. The user creates a project (Python / JavaScript / custom Docker), starts a compute job (free or paid), watches status + streamed logs, and gets results pulled back into the project's `results/` folder. It also manages **persistent storage buckets** on the connected node.

- It is a **client of Ocean Nodes** — it talks to them via `@oceanprotocol/lib` (`ProviderInstance`), which dispatches over **libp2p P2P** (the default and normal path here — node targets are multiaddrs) or HTTP. There is no local server/indexer in this repo; the heavy lifting lives on the remote node.
- TypeScript, bundled by **webpack** to a single CommonJS `dist/extension.js`. Node pinned to `v20.16.0` (`.nvmrc`); requires VS Code `^1.96.0`.
- Blockchain/signing is **ethers v6**. Auth to nodes is wallet-based (either an ephemeral generated wallet for free compute, or a real wallet's auth token delivered from the web dashboard — see Architecture).
- No React/framework in the webviews — both UIs are **inline HTML/JS template strings** (`viewProvider.ts`, `storagePanel.ts`). There is no build step for webview code.

## Common commands

Run `nvm use` first (`.nvmrc` = `v20.16.0`).

Build / develop:
- `npm run compile` — webpack dev build (`mode: none`) → `dist/extension.js`.
- `npm run watch` — webpack watch; this is the default build task, run by **F5** ("Run Extension" launch config) which opens an Extension Development Host.
- `npm run package` — production webpack (`--mode production --devtool hidden-source-map`); runs as `vscode:prepublish`.
- `npm run build` — `vsce package` → produces the `.vsix` (invokes `package` via prepublish).
- `npm run lint` — ESLint over `src` (flat config `eslint.config.mjs`; most rules are `warn`).

Tests:
- `npm test` — the real gate. `pretest` runs `compile-tests` (tsc → `out/`), then `vscode-test` runs `out/test/run.test.js` in a downloaded VS Code, then `posttest` runs `lint`. **Needs a display** — CI uses `xvfb-run -a npm test`.
- `npm run compile-tests` — `tsc -p . --module commonjs --moduleResolution node --outDir out` (tests are compiled to **CommonJS in `out/`**, separate from the webpack bundle).
- `npm run test-vs` — `vscode-test` using `.vscode-test.mjs` (globs `out/test/**/*.test.js`).

Publish (normally automatic — see gotchas):
- `npm run publish` (VS Code Marketplace, `vsce`), `npm run publish:ovsx` (Open VSX, `ovsx`), `npm run publish:all` (both).

Note: `.mocharc.json` (ts-node over `src/test/**/*.test.ts`) exists but is **not** wired into any npm script; the maintained test path is `vscode-test` → `out/`.

## Architecture

### Entry point — `src/extension.ts`
`activate()` wires everything. On startup it: seeds an `anonymousId` in `globalState`, inits PostHog analytics, calls `ProviderInstance.setupP2P({ bootstrapPeers })`, registers the sidebar webview provider, and registers all commands. A module-level `SelectedConfig` singleton (`config`) holds the current node connection state (`multiaddresses`, `authToken`, `address`, `chainId`, `environmentId`, `isFreeCompute`, `feeToken`, `jobDuration`, `resources`) and is mutated in place throughout.

Registered commands (only some are ever declared in `package.json`): `ocean-protocol.startComputeJob`, `stopComputeJob`, `downloadResults`, `getEnvironments`, `getStatus`, `validateDataset`, `openStoragePanel`, `test`.

### Two webviews (both plain inline HTML + `postMessage`)
- **`viewProvider.ts` (`OceanProtocolViewProvider`, view id `oceanOrchestrator`)** — the activity-bar sidebar. Create/select project, Run Job, Stop, Download Results, Check connection, Configure Compute, Configure Persistent Storage. `retainContextWhenHidden: true`. UI ↔ extension is a `window.addEventListener('message')` / `vscode.postMessage({type})` protocol; each `type` maps to a command in `extension.ts`.
- **`storagePanel.ts` (`StoragePanel`)** — a separate editor-column panel (singleton `currentPanel`) for persistent-storage buckets/files. It uses a request/response protocol (`requestId` correlation) handled by `handleStoragePanelMessage` in `extension.ts`.

### Config handshake with the web dashboard (deep link)
Paid compute and persistent storage require config the extension cannot produce itself (a real wallet's `authToken`, `chainId`, `feeToken`, resources). Flow: the "Configure Compute" button opens `https://dashboard.oncompute.ai/run-job/environments` in the browser (passing `ide`, `isFreeCompute`, `multiaddresses`); the dashboard signs and deep-links back via a `vscode://` URI handled by `vscode.window.registerUriHandler` in `extension.ts`, which parses query params into `config` and re-runs `setupP2P`. Without this handshake, persistent storage throws `MissingDashboardConfigError`.

### Compute job lifecycle (`src/helpers/compute.ts`)
`startComputeJob` reads the algorithm file, `Dockerfile`, any additional files in the algo dir, and `.env` (parsed to `envVars`) → `computeStart()` → `ProviderInstance.freeComputeStart` (free) or `computeStart` (paid) → poll `checkComputeStatus` every 5s → when status is "Running algorithm", stream logs into an `Algorithm Logs - {jobId}` output channel (`getComputeLogs`, ANSI-stripped) → on `dateFinished`, record the job in the in-memory `completedJobs` map → user clicks Download Results → `saveOutput` fetches `outputs.tar`, extracts it, and `getAndSaveLogs` saves log files. Container image selection (`getContainerConfig`): project `Dockerfile` wins, else custom image/tag, else default `oceanprotocol/c2d_examples` (`py-general`/`js-general`) by file extension.

- **Datasets** (`getComputeAsset`, mirrored in `helpers/validation.ts`): `did:` → `resolveDdo`; `http` → URL; `Qm` → IPFS; otherwise probe `arweave.net` then `ipfs.io`.
- **Auth for free compute**: a fresh `ethers.Wallet.createRandom()` is generated per session and turned into an auth token via `generateAuthToken` (no user wallet involved).
- `withRetrial` wraps status/result calls with exponential backoff.

### Persistent storage
`helpers/persistentStorage.ts` wraps `ProviderInstance.*PersistentStorage*` and normalizes errors into typed classes (`MissingDashboardConfigError`, `AuthExpiredError`, `FileTooLargeError`) → `StorageErrorCode`. Two in-memory registries keyed by a `{nodeUri, chainId}` scope: `persistentMountRegistry.ts` (files ticked to bind-mount into the next job) and `outputBucketRegistry.ts` (single bucket a job writes results into). Before a job starts, `resolvePersistentMountAssets` re-verifies mounted files still exist on the node and un-mounts stale ones (aborting the start). Mounted files appear in the container at `/data/persistentStorage/<bucketId>/<fileName>` (read-only). Algorithms must write outputs to `./data/outputs/`.

### Other helpers
- `helpers/p2p.ts` — `DEFAULT_MULTIADDR`, the single hardcoded default node target.
- `helpers/auth.ts` — request signing / JWT decode; special-cases chainId `8996` (barge) with `_legacySignMessage`.
- `helpers/analytics.ts` — PostHog (hardcoded EU project key). Captures `nativeFetch` **before** `extension.ts` overwrites `globalThis.fetch`.
- `helpers/project-data.ts` — new-project templates (Python/JavaScript/Docker Image), `Dockerfile`/deps/algo scaffolding, `detectProjectType`.
- `helpers/indexer.ts` (`fetchDdoByDid`), `helpers/path.ts`, `helpers/constants.ts` (bootstrap/OPF node lists), `helpers/strip-ansi.ts`, `types.ts` (`SelectedConfig`, webview message types), `enum.ts` (`PROTOCOL_COMMANDS`).

## Conventions & gotchas

- **`navigator` polyfill is load-bearing.** The top of `extension.ts` redefines `globalThis.navigator` because `@oceanprotocol/lib`'s bundled libp2p reads `navigator.userAgent`, and the VS Code extension host exposes `navigator` as a getter returning `undefined`. Remove it and every P2P call throws `Cannot read properties of undefined (reading 'userAgent')`.
- **Two output trees, don't confuse them.** webpack emits the shipped bundle to `dist/extension.js`; `compile-tests` emits CommonJS tests to `out/`. `tsconfig.json`'s `outDir: ./dist/node/` is used by neither (both override it) and its `include` lists `src/tests/**` — the actual dir is `src/test`. Treat tsconfig's paths as vestigial.
- **Tests mock the whole P2P layer.** `src/test/run.test.ts` `mock-require`s the ESM-only libp2p/uint8arrays packages (so `require()` doesn't throw in the CommonJS test context) and the suite stubs `ProviderInstance` with sinon. Tests never hit a real node. After editing source or tests, re-run `npm test` (it recompiles `out/` first).
- **State is in-memory and session-scoped.** `completedJobs` (capped at 50), mount/output-bucket registries, and the `config` singleton all live in memory. Results are only downloadable in the session that produced them ("Job results not found in this session"). Only `anonymousId`, `configCount`, `hasTrackedInstall` persist (via `globalState`).
- **Publishing is automatic on merge to `main`.** `.github/workflows/publish.yml` (job name "CI") runs `vsce publish` + `ovsx publish` on push to `main`. **Bump `version` in `package.json`** or the marketplace publish fails on a duplicate version. `.github/workflows/ci.yml` (name "Tests") runs the test suite on PRs/pushes.
- **`package.json` `contributes.commands` / `activationEvents` are stale.** They reference `ocean-protocol.searchAssets` / `getAssetDetails`, which are **not** registered anywhere. The extension actually activates via its contributed view. Don't rely on those entries.
- **`ai-instructions/` is a git submodule** (`oceanprotocol/ai-instructions`) — shared agent instructions. Don't hand-edit it here; changes go to the submodule repo.
- **`metadata/`** holds example algorithms/datasets (demo fixtures), not code the extension imports at runtime.
- **Style** (`.prettierrc`): no semicolons, single quotes, `printWidth: 90`, no trailing commas, 2-space indent.
- The committed `ocean-protocol-vscode-extension-0.0.1.vsix` is a stale build artifact; the source is at `version` 0.2.x.
