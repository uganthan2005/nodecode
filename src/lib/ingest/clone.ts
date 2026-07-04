import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GITHUB_REPO_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/**
 * Wipes a temp clone directory (TRD §7 isolation). Never throws — a failed
 * cleanup must not mask the real error in a caller's `finally`, and customer
 * IP must never survive a session. Retries handle Windows locks on git packs.
 */
async function safeWipe(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
  } catch (error) {
    // Best-effort: log and move on. The OS reclaims the temp root eventually.
    console.warn(`temp clone wipe failed for ${dir}:`, error);
  }
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export function parseRepoUrl(repoUrl: string): RepoRef {
  const match = repoUrl.match(GITHUB_REPO_URL);
  if (!match) {
    throw new Error(`Not a valid GitHub repository URL: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Shallow-clones a GitHub repo into an isolated temp directory (TRD §7:
 * cloning happens in a throwaway volume, wiped after the sync completes).
 * Caller MUST invoke `cleanup` in a finally block.
 */
export async function cloneRepo(
  repoUrl: string,
  branch: string,
  accessToken?: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const dir = await mkdtemp(path.join(tmpdir(), "nodecode-ingest-"));

  // Token goes into the URL only for the child process — never logged
  const cloneUrl = accessToken
    ? `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--single-branch", "--branch", branch, cloneUrl, dir],
      { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
  } catch (error) {
    await safeWipe(dir);
    const message = error instanceof Error ? error.message : String(error);
    // Never leak the tokenized URL back to the caller
    throw new Error(
      `git clone failed for ${owner}/${repo}@${branch}: ${message.replaceAll(cloneUrl, "<repo>")}`,
    );
  }

  return {
    dir,
    cleanup: () => safeWipe(dir),
  };
}
