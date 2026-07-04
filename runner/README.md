# nodecode-runner

Local CLI that binds your terminal to a NodeCode workspace (TRD §7).

It pulls the workspace's files and the generated Docker envelope, writes them to
disk, boots `docker compose`, and keeps a live two-way sync over the WS relay:
browser edits land on disk, local edits push back into the graph.

## Usage

In the NodeCode studio, click **Connect Runner** to mint a pairing token, then:

```bash
npx nodecode-runner <token>
```

Options:

| Flag      | Default                  | Meaning                          |
| --------- | ------------------------ | -------------------------------- |
| `--api`   | `http://localhost:3000`  | NodeCode backend base URL        |
| `--relay` | `ws://localhost:3001`    | WS relay URL                     |
| `--dir`   | `./nodecode-project`     | Local directory to materialize   |

## Dev (from this repo)

The runner resolves `ws` + `chokidar` from the repo's `node_modules`, so you can
run it without a separate install:

```bash
# terminal 1: the WS relay
npm run relay
# terminal 2: the runner
node runner/cli.mjs <token>
```

Requires Docker running locally to boot the container envelope; without Docker it
falls back to sync-only mode (files still materialize and stay in sync).
