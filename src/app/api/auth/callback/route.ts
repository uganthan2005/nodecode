import { NextResponse, type NextRequest } from "next/server";
import { encryptSecret } from "@/lib/crypto";
import {
  exchangeCodeForToken,
  fetchGitHubProfile,
  OAUTH_STATE_COOKIE,
} from "@/lib/github";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

// GitHub OAuth callback (Backend Schema §1, steps 2–4):
// verify state → exchange code → fetch profile → upsert user → issue JWT cookie.

function failureRedirect(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/", request.nextUrl);
  url.searchParams.set("error", reason);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !storedState || state !== storedState) {
    return failureRedirect(request, "oauth_state_mismatch");
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const profile = await fetchGitHubProfile(accessToken);

    if (!profile.email) {
      return failureRedirect(request, "no_verified_email");
    }

    const user = await prisma.user.upsert({
      where: { githubId: profile.githubId },
      update: {
        email: profile.email,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        githubAccessToken: encryptSecret(accessToken),
      },
      create: {
        githubId: profile.githubId,
        email: profile.email,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        githubAccessToken: encryptSecret(accessToken),
      },
    });

    const sessionToken = await createSessionToken(user.id);
    const response = NextResponse.redirect(new URL("/dashboard", request.nextUrl));
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error("OAuth callback failed:", error);
    return failureRedirect(request, "oauth_failed");
  }
}
