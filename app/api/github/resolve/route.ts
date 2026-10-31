import { NextRequest, NextResponse } from "next/server";
import { parseGitHubUrl } from "../../../../lib/github-url";
import { repoIdentitySchema } from "../../../../lib/domain";

export const runtime = "edge";

const headers = { Accept: "application/vnd.github+json", "User-Agent": "Repo-Interview-Coach", "X-GitHub-Api-Version": "2022-11-28" };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { url?: string };
    const { owner, repository } = parseGitHubUrl(body.url ?? "");
    const repoResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, { headers, cf: { cacheTtl: 300 } } as RequestInit);
    if (repoResponse.status === 404) return NextResponse.json({ error: "Repository not found. It may be private or the URL may be incorrect." }, { status: 404 });
    if (repoResponse.status === 403 && repoResponse.headers.get("x-ratelimit-remaining") === "0") return NextResponse.json({ error: "GitHub's public API rate limit has been reached. Try again after the reset time.", resetAt: repoResponse.headers.get("x-ratelimit-reset") }, { status: 429 });
    if (!repoResponse.ok) throw new Error(`GitHub returned ${repoResponse.status}.`);
    const repo = await repoResponse.json() as { default_branch: string; html_url: string; private: boolean; archived?: boolean };
    if (repo.private) return NextResponse.json({ error: "Private repositories are not supported in this release." }, { status: 400 });
    const commitResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(repo.default_branch)}`, { headers, cf: { cacheTtl: 300 } } as RequestInit);
    if (!commitResponse.ok) throw new Error("Could not resolve the repository's current default-branch commit.");
    const commit = await commitResponse.json() as { sha: string };
    const identity = repoIdentitySchema.parse({ owner, repository, defaultBranch: repo.default_branch, headSha: commit.sha, sourceUrl: repo.html_url });
    return NextResponse.json({ identity, archived: Boolean(repo.archived), rateLimitRemaining: repoResponse.headers.get("x-ratelimit-remaining") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not resolve repository." }, { status: 400 });
  }
}

