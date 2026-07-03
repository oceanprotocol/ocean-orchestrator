# Ocean Orchestrator

Run affordable GPU AI jobs from your editor with a one-click workflow and pay-per-use mechanism.

<a href="https://www.producthunt.com/products/ocean-orchestrator?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-ocean-orchestrator" target="_blank" rel="noopener noreferrer"><img align="right" alt="Ocean Orchestrator - Run AI jobs from your IDE with a one-click workflow | Product Hunt" width="200" height="43" src="https://api.producthunt.com/widgets/embed-image/v1/featured.png?post_id=1099908&amp;theme=light&amp;t=1773747830547"/></a>

Ocean Orchestrator lets you submit a containerized compute job to remote nodes, monitor it, and automatically pull the results back. It uses Ocean Compute-to-Data (C2D), meaning the job runs in an isolated container near the data and only the outputs are returned. This gives you a low-friction way to run batch jobs without spinning up or managing servers.

Ocean Network coordinates those remote runs across a distributed set of GPU nodes, handling orchestration behind the scenes so pay-per-use compute jobs stay usable even as more nodes and workloads join.

Works in VS Code, Cursor, Antigravity, and Windsurf.

> If you use Cursor, Antigravity, or Windsurf, install Ocean Orchestrator the same way you install VS Code extensions in your editor, or use the [Open VSX](https://open-vsx.org/) listing if your editor does not support the VS Code Marketplace.

![Ocean Orchestrator](./screenshots/main-screenshot.png)

## Features

### One-Click Job Runs

Run a job without spinning up servers. Create a project, press **Start Compute Job**, and receive the outputs in your folder. Supports Python and JavaScript projects with built-in templates and dependencies.

### Pay Per Use Compute

Start with free compute for quick tests, then switch to paid compute jobs when you need more resources.

### Compute-to-Data

Your code runs in an isolated container, and only results are returned, so data stays sealed.

### Remote AI Compute

Run embeddings, inference, data cleanup, batch processing, and other containerized workloads without provisioning servers.

### Real Time Monitoring

Track job status and view logs directly in your editor via the Output console.

### Automatic Results Retrieval

Outputs and logs are saved to your results folder as soon as the job completes.

## Getting Started

1. Install Ocean Orchestrator from your favorite extension marketplace in the extensions tab of your IDE. We currently support VS Code, Cursor, Antigravity, and Windsurf.
2. Open the Ocean Orchestrator panel from the activity bar.
3. Create a new project folder:
   - Choose a parent directory for your project
   - Name your project (default: `new-compute-job`)
   - Select your language: Python, JavaScript, or your own container
4. Explore your project structure:
   - Algorithm file (`.py` or `.js`)
   - Dockerfile with environment setup
   - Dependencies file (`requirements.txt` or `package.json`)
   - `.env` secrets file — contents are passed as environment variables into the container
5. Run the job — see **Running a Job** below for the free and paid paths.
6. Monitor job status and logs in the Output console.
7. Check results and logs in your project's `results/<job-name>_<date>_<time>/` folder.

### Extension Layout

Ocean Orchestrator adds a dedicated Ocean section to the activity bar. The sidebar shows:

- A **status line** with the node connection state (Connecting… / Connected / Failed) and your wallet address when connected.
- A **project selector** (`Select`) to create or pick a compute project.
- An **environment card** (paid mode only) with the selected environment's resources, estimated cost, and escrow balance, plus a **Configure ⚙** button.
- A primary **Run** button (`Run free test job` or `Run job`) that doubles as **Stop job** for a running job.
- A **Download results** button for the selected job.
- A **Jobs** list with your current and recent jobs.
- **Connect for paid environments ↗** and **Manage storage ↗** links.

### Running a Job

#### Free run

1. Create a new project folder or select an existing one.
2. Review your algorithm, Dockerfile, and dependencies.
3. Optionally set a job name (a friendly name is generated automatically).
4. Click **Run free test job**. The job runs on the default public node with preset resources — no wallet required.
5. Monitor job status and real-time logs in the Output console.

#### Paid run

1. Click **Connect for paid environments ↗** in the sidebar (or start from the [Ocean dashboard](https://dashboard.oncompute.ai)). The dashboard sends the extension a `vscode://` deep link that configures your wallet, node, environment, fee token, resources, and duration. The sidebar switches to paid mode and persistent storage unlocks.
2. *Optionally* click **Configure ⚙** to refine the environment, resources, GPUs, dataset, and duration in the Configure Job panel (see below).
3. If your escrow balance is below the estimated cost, click **Add funds** to top up.
4. Click **Run job** in the sidebar.

**Important:** Your algorithm must write all outputs to `./data/outputs/` inside the container. The runtime mounts this path and returns only what is written there.

Python example:

```python
import os, json
os.makedirs("./data/outputs", exist_ok=True)
with open("./data/outputs/result.json", "w") as f:
    json.dump({"result": "..."}, f)
```

JavaScript example:

```js
const fs = require('fs')
fs.mkdirSync('./data/outputs', { recursive: true })
fs.writeFileSync('./data/outputs/result.json', JSON.stringify({ result: '...' }))
```

## Configure Job & Paid Compute

The Configure Job panel refines the paid setup the dashboard handshake created. Open it with the **Configure ⚙** button in the sidebar's environment card, or run **Ocean: Configure Job** from the Command Palette.

In the panel you can:

- **Environment** — choose a paid compute environment (filtered to the supported network and fee tokens).
- **Fee token** — pick the ERC-20 token used to pay for the run.
- **CPU / RAM / Disk / Duration** — adjust with sliders, bounded by the selected environment's limits.
- **GPUs** — tick the specific GPUs to attach (shown by model, e.g. NVIDIA H200).
- **Dataset** — optionally provide a dataset URL/DID to mount for the job.
- **Estimated cost vs escrow balance** — the panel shows a live `Est. cost ≈ … / run` and your current `Escrow …` balance, with a warning when the balance is insufficient.
- **Add funds ↗** — opens the dashboard escrow page to top up.
- **Mount from storage ↗** — opens the Persistent Storage panel to attach bucket files as inputs.
- **Save** — applies the configuration back to the sidebar so you can run from there.

Paid jobs charge per run based on the selected resources, GPUs, duration, and environment. Free jobs use minimal preset resources on the default public node and require no payment.

## Job History & Monitoring

The **Jobs** list in the sidebar merges your local session jobs with your job history from the Ocean incentive backend (when connected). Each row shows the job name and a status badge (Running, Completed, Failed, Stopped, or Queued); a running job is pinned to the top, and a running timer is shown for it. Use **Show N more** to expand the list.

- **Select a job** — click a row to view its logs in the Output console and enable **Download results** / **Stop job** for that job.
- **Status sync** — non-terminal jobs are periodically refreshed so their status updates without manual action.
- **Refresh** — use the refresh control in the status line to re-fetch the default environment and job list.

## Project Templates

When you create a new project, Ocean Orchestrator generates a template based on your selected language:

| Template     | Algorithm file                 | Dependencies                                 | Dockerfile                              |
| ------------ | ------------------------------ | -------------------------------------------- | --------------------------------------- |
| Python       | `algo.py`                      | `requirements.txt` (numpy, pandas, requests) | Ubuntu 24.04, Python 3 venv             |
| JavaScript   | `algo.js`                      | `package.json` (axios, bignumber.js, ethers) | Node 22 multi-stage                     |
| Docker Image | `algo.placeholder` (docs only) | none                                         | none — provide image and tag before running |

A `.env` file is generated for all templates. Any variables you add there are passed as environment variables into the container at runtime.

For the Docker Image template, no Dockerfile is created. Provide your image and tag before starting a job.

## Results

After a job completes, outputs are saved to your project folder under a folder named after the job:

```
results/
  <job-name>_<date>_<time>/
    result-output.tar
    result-output_extracted/
      ...your algorithm's ./data/outputs/ contents...
    logs/
      ...log files...
```

The folder name combines the job's name with its creation date and time, e.g. `swift-falcon_2025-03-15_1430`. Jobs without a friendly name fall back to a short job id. If results were written to a persistent-storage output bucket (see below), they are kept in that bucket instead of downloaded as an archive.

## Logs

Ocean Orchestrator exposes logs in two places:

**Output channels** (View > Output in your editor):

- **Ocean Orchestrator** — general status and progress messages for the job lifecycle
- **Algorithm Logs - {jobId}** — live stdout/stderr streamed from your algorithm while the job is running

**Filesystem logs** — after job completion, log files are saved to:

```
results/<job-name>_<date>_<time>/logs/
```

## Persistent Storage

Reuse files across jobs without re-uploading. Files live on the connected node, organized into **buckets** owned by your address.

Persistent storage requires connecting through the Ocean dashboard — it needs a wallet, network, and signed session. Until you connect, the Storage panel is locked and shows an **Open dashboard** button. Free/first-run compute jobs run without storage.

**Workflow:**

1. Open the **Manage storage ↗** link in the sidebar.
2. **Create bucket** — leave the access list contract blank for owner-only access, or add one to share with addresses on a whitelist contract.
3. **Upload** files into the bucket.
4. **Mount** the files you want available to your next compute job (tick them in the bucket). Mounts are remembered per node and network.
5. Run a job as usual — mounted files are bind-mounted into the algorithm container.

Optionally set a bucket as the **output bucket** for the current node so a job's results are written directly to it instead of downloaded locally.

**Accessing files in your algorithm**

Mounted files appear at `/data/persistentStorage/<bucketId>/<fileName>` (read-only). They are **not** placed in `/data/inputs/`.

## Settings

- **`ocean.baseRpcUrl`** (default `https://mainnet.base.org`) — the Base RPC endpoint used for escrow balance reads and on-chain queries. Set this to a private RPC provider for better reliability.

## Troubleshooting

- **Job cannot start** — Check the node connection state in the sidebar status line; for paid jobs, confirm an environment is selected in the Configure Job panel.
- **Not enough funds / insufficient escrow** — Run a free job instead, or use **Add funds** in the Configure Job panel to top up your escrow balance.
- **Storage is locked** — Persistent storage is only available after you connect through the Ocean dashboard. Use the **Open dashboard** button in the Storage panel.
- **General issues** — Check logs in the Output console. Logs are also saved in your project folder under `results/<job-name>_<date>_<time>/logs/`.

## Development and Contributing

Contributions are welcome. Please check the repository guidelines for local development and PRs.

### Prerequisites

- Node.js (version specified in `.nvmrc`)
- VSCode version 1.93.0 or higher
- Git

### Running the Extension Locally

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/ocean-protocol-vscode
   cd ocean-protocol-vscode
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run compile
   ```

4. Open in VSCode:
   - Press F5 to start debugging. This will open a new VSCode window with the extension loaded.

### Publishing the Extension

For the CI to publish the extension, you just need to ensure that the version number is bumped in `package.json` on main, and then the rest is automatic via the GitHub CI.

## Prefer to drive it from your AI assistant?

If you're learning about AI, machine learning, and algorithms, try the **[ON MCP](https://docs.oncompute.ai/on-mcp/quickstart)** the compute distributed network, driven straight from **Claude**, **Gemini**, **ChatGPT**, **Cursor** or **Github Copilot**. Instead of clicking through panels, you just describe what you want: The AI agent writes and validates your algorithm, finds the right compute environment, and runs free or paid jobs for you. It's the fastest way to go from a question to a real result, and to become hands-on with ML training without leaving your chat.

Add it to any MCP-compatible AI platform (Claude, Gemini, ChatGPT, Cursor, GitHub Copilot, and more) using the connector URL:

```
https://mcp.oncompute.ai/mcp
```

> Get started with the [ON Compute MCP quickstart](https://docs.oncompute.ai/on-mcp/quickstart).
