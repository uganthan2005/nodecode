// GitHub OAuth 2.0 client (Backend Schema §1) — hand-rolled per spec, no auth framework.

export const OAUTH_STATE_COOKIE = "nodecode_oauth_state";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_BASE = "https://api.github.com";

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set");
  }
  return { clientId, clientSecret };
}

export function getCallbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/auth/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl(),
    scope: "repo user:email",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getCallbackUrl(),
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(
      `GitHub token exchange rejected: ${data.error ?? "unknown"} ${data.error_description ?? ""}`,
    );
  }
  return data.access_token;
}

export interface GitHubProfile {
  githubId: number;
  username: string;
  email: string | null;
  avatarUrl: string;
}

async function githubGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchGitHubProfile(
  accessToken: string,
): Promise<GitHubProfile> {
  const user = await githubGet<{
    id: number;
    login: string;
    email: string | null;
    avatar_url: string;
  }>("/user", accessToken);

  let email = user.email;
  if (!email) {
    // Public email can be hidden — the user:email scope grants access to the emails endpoint
    const emails = await githubGet<
      Array<{ email: string; primary: boolean; verified: boolean }>
    >("/user/emails", accessToken);
    email =
      emails.find((e) => e.primary && e.verified)?.email ??
      emails.find((e) => e.verified)?.email ??
      null;
  }

  return {
    githubId: user.id,
    username: user.login,
    email,
    avatarUrl: user.avatar_url,
  };
}
