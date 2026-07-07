#!/usr/bin/env node
// nodecode-runner (TRD §7): the local CLI that binds a terminal to a NodeCode
// workspace. It pulls the workspace's files + generated Docker envelope, writes
// them to disk, boots `docker compose`, then keeps a live two-way sync over the
// WS relay — browser edits land on disk; local edits push back to the graph.
//
//   npx nodecode-runner <token> [--api http://localhost:3000]
//                               [--relay ws://localhost:3001]
//                               [--dir ./nodecode-project]

import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import chokidar from "chokidar";
import { WebSocket } from "ws";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { token: null, api: "http://localhost:3000", relay: "ws://localhost:3001", dir: "./nodecode-project" };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--api") args.api = rest[++i];
    else if (a === "--relay") args.relay = rest[++i];
    else if (a === "--dir") args.dir = rest[++i];
    else if (!a.startsWith("--")) args.token = a;
  }
  return args;
}

const log = (...m) => console.log("[runner]", ...m);
const warn = (...m) => console.warn("[runner]", ...m);

// Integrated Terminal (Phase 5 §2): a plain child_process shell, not a real
// pty (no node-pty — avoids a native build on top of everything else this
// project's local dev env has already fought). Full-screen interactive
// programs won't render right, but streaming npm/git output works fine.
let shellProc = null;

function ensureShell(dir, holder) {
  if (shellProc && !shellProc.killed) return shellProc;

  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd.exe" : process.env.SHELL || "/bin/bash";
  const shellArgs = isWin ? [] : ["-i"];

  const child = spawn(cmd, shellArgs, {
    cwd: dir,
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  const sendOutput = (chunk) => {
    const ws = holder.ws;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "term:output", data: chunk.toString("utf8") }));
    }
  };
  child.stdout.on("data", sendOutput);
  child.stderr.on("data", sendOutput);
  child.on("exit", (code) => {
    const ws = holder.ws;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "term:exit", code }));
    }
    shellProc = null;
  });
  child.on("error", (err) => warn(`terminal shell error: ${err.message}`));

  log(`terminal shell spawned (${cmd})`);
  shellProc = child;
  return child;
}

// Source Control (Phase 5 §3): thin wrappers around the local `git` CLI.
// Args are always passed as an array to execFile (never a shell string), so
// there's no shell-interpolation surface regardless of what a commit message
// or file path contains.

async function gitStatus(dir) {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-b"], {
    cwd: dir,
  });
  const lines = stdout.split("\n").filter(Boolean);
  const branchLine = lines.find((l) => l.startsWith("##"));
  const branch = branchLine ? branchLine.slice(3).split("...")[0].trim() : "unknown";
  const files = lines
    .filter((l) => !l.startsWith("##"))
    .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3).trim() }));
  return { branch, files };
}

async function gitFileDiff(dir, filePath) {
  const [original, modified] = await Promise.all([
    execFileAsync("git", ["show", `HEAD:${filePath.replaceAll("\\", "/")}`], { cwd: dir })
      .then((r) => r.stdout)
      .catch(() => ""), // untracked / new file — no committed version
    readFile(path.join(dir, filePath), "utf8").catch(() => ""),
  ]);
  return { original, modified };
}

async function gitCommitAndPush(dir, message) {
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", message], { cwd: dir });
  await execFileAsync("git", ["push"], { cwd: dir });
}

async function writeProjectFile(dir, filePath, content, writtenByUs) {
  const abs = path.join(dir, filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  writtenByUs.set(path.resolve(abs), Date.now());
  await writeFile(abs, content, "utf8");
}

async function pullAndWrite(args, writtenByUs) {
  log(`pulling workspace from ${args.api} ...`);
  const res = await fetch(`${args.api}/api/runner/pull`, {
    headers: { "x-nodecode-token": args.token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`pull failed (${res.status}): ${body.error ?? "unknown"}`);
  }
  const data = await res.json();
  log(`workspace "${data.name}" — ${data.files.length} file(s), db=${data.database}`);

  for (const file of data.files) {
    await writeProjectFile(args.dir, file.filePath, file.source, writtenByUs);
  }
  for (const file of data.envelope) {
    await writeProjectFile(args.dir, file.path, file.content, writtenByUs);
  }
  log(`wrote project to ${path.resolve(args.dir)}`);
  return data;
}

function bootDocker(dir) {
  return new Promise((resolve) => {
    log("booting: docker compose up -d --build");
    const child = spawn("docker", ["compose", "up", "-d", "--build"], {
      cwd: dir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (err) => {
      warn(`could not run docker (${err.message}).`);
      warn("skipping container boot — fix Docker, then re-run this command.");
      resolve(false);
    });
    child.on("exit", (code) => {
      if (code === 0) log("docker environment is up.");
      else warn(`docker compose exited with code ${code}; continuing in sync-only mode.`);
      resolve(code === 0);
    });
  });
}

function connectRelay(args, dir, writtenByUs, holder) {
  const ws = new WebSocket(args.relay);
  holder.ws = ws;

  ws.on("open", () => {
    log(`connected to relay ${args.relay}`);
    ws.send(JSON.stringify({ type: "hello", token: args.token, role: "runner" }));
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "ready") {
      log(`paired to workspace ${msg.workspaceId}${msg.peers?.length ? ` (browser online)` : ""}`);
    } else if (msg.type === "error") {
      warn(`relay error: ${msg.message}`);
    } else if (msg.type === "peer") {
      log(`browser ${msg.connected ? "connected" : "disconnected"}`);
    } else if (msg.type === "invalidate" && msg.origin === "browser") {
      // Browser persisted an edit -> re-pull the workspace to disk
      try {
        await pullAndWrite(args, writtenByUs);
        log("re-pulled after browser edit");
      } catch (err) {
        warn(`re-pull failed: ${err.message}`);
      }
    } else if (msg.type === "fileChanged" && msg.origin === "browser") {
      // Direct file push (full source) -> land it on disk
      try {
        await writeProjectFile(dir, msg.filePath, msg.source, writtenByUs);
        log(`applied browser edit -> ${msg.filePath}`);
      } catch (err) {
        warn(`failed to write ${msg.filePath}: ${err.message}`);
      }
    } else if (msg.type === "term:input" && msg.origin === "browser") {
      // Lazily spawn the shell on first keystroke / quick action. xterm.js
      // sends a bare \r for Enter; cmd.exe reading piped (non-pty) stdin
      // needs a full CRLF to treat the line as complete.
      const data = process.platform === "win32" ? msg.data.replace(/\r(?!\n)/g, "\r\n") : msg.data;
      ensureShell(dir, holder).stdin.write(data);
    } else if (msg.type === "term:resize" && msg.origin === "browser") {
      // No real pty to resize — no-op (accepted limitation of plain spawn).
    } else if (msg.type === "git:status" && msg.origin === "browser") {
      const ws2 = holder.ws;
      try {
        const result = await gitStatus(dir);
        if (ws2?.readyState === ws2.OPEN) {
          ws2.send(JSON.stringify({ type: "git:status", ...result }));
        }
      } catch (err) {
        if (ws2?.readyState === ws2.OPEN) {
          ws2.send(JSON.stringify({ type: "git:error", op: "status", message: err.message }));
        }
      }
    } else if (msg.type === "git:diff" && msg.origin === "browser") {
      const ws2 = holder.ws;
      try {
        const result = await gitFileDiff(dir, msg.filePath);
        if (ws2?.readyState === ws2.OPEN) {
          ws2.send(JSON.stringify({ type: "git:diff", filePath: msg.filePath, ...result }));
        }
      } catch (err) {
        if (ws2?.readyState === ws2.OPEN) {
          ws2.send(JSON.stringify({ type: "git:error", op: "diff", message: err.message }));
        }
      }
    } else if (msg.type === "git:commit" && msg.origin === "browser") {
      const ws2 = holder.ws;
      try {
        await gitCommitAndPush(dir, msg.message);
        if (ws2?.readyState === ws2.OPEN) {
          ws2.send(JSON.stringify({ type: "git:commit", ok: true }));
        }
        log("committed and pushed local changes");
      } catch (err) {
        warn(`git commit/push failed: ${err.message}`);
        if (ws2?.readyState === ws2.OPEN) {
          ws2.send(JSON.stringify({ type: "git:commit", ok: false, error: err.message }));
        }
      }
    }
  });

  ws.on("close", () => {
    warn("relay disconnected; retrying in 3s");
    setTimeout(() => connectRelay(args, dir, writtenByUs, holder), 3000);
  });
  ws.on("error", (err) => warn(`relay socket error: ${err.message}`));

  return ws;
}

function watchLocal(args, dir, writtenByUs, getWs) {
  const abs = path.resolve(dir);
  const pending = new Map(); // filePath -> source
  let flushTimer = null;

  const watcher = chokidar.watch(abs, {
    ignoreInitial: true,
    ignored: (p) =>
      /(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/.test(p),
  });

  const flush = async () => {
    flushTimer = null;
    const files = [...pending].map(([filePath, source]) => ({ filePath, source }));
    pending.clear();
    if (files.length === 0) return;

    // Push to the cloud graph
    try {
      const res = await fetch(`${args.api}/api/runner/push`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nodecode-token": args.token },
        body: JSON.stringify({ files }),
      });
      if (res.ok) log(`pushed ${files.length} local edit(s) to graph`);
      else warn(`push failed (${res.status})`);
    } catch (err) {
      warn(`push error: ${err.message}`);
    }
    // Notify the browser peer to refresh
    const ws = getWs();
    if (ws && ws.readyState === ws.OPEN) {
      for (const f of files) {
        ws.send(JSON.stringify({ type: "fileChanged", filePath: f.filePath, source: f.source }));
      }
    }
  };

  const onChange = async (p) => {
    const resolved = path.resolve(p);
    // Ignore only .ts/.tsx (graph source); skip generated envelope files
    if (!/\.(ts|tsx)$/.test(resolved)) return;
    // Suppress echoes of files we just wrote ourselves
    const writtenAt = writtenByUs.get(resolved);
    if (writtenAt && Date.now() - writtenAt < 1500) return;

    const rel = path.relative(abs, resolved).replaceAll("\\", "/");
    try {
      pending.set(rel, await readFile(resolved, "utf8"));
    } catch { return; }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  };

  watcher.on("add", onChange).on("change", onChange);
  log(`watching ${abs} for local edits`);
  return watcher;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.token) {
    console.error("usage: nodecode-runner <token> [--api URL] [--relay URL] [--dir PATH]");
    process.exit(1);
  }

  const writtenByUs = new Map(); // resolved path -> timestamp (echo suppression)
  await mkdir(args.dir, { recursive: true });

  try {
    await pullAndWrite(args, writtenByUs);
  } catch (err) {
    console.error("[runner] fatal:", err.message);
    process.exit(1);
  }

  await bootDocker(args.dir);

  // Shared holder so the file watcher always reaches the current socket,
  // even across relay reconnects (connectRelay updates holder.ws itself).
  const holder = { ws: null };
  connectRelay(args, args.dir, writtenByUs, holder);

  watchLocal(args, args.dir, writtenByUs, () => holder.ws);
  log("live sync active. Press Ctrl+C to stop.");
}

main();
