import { NextRequest, NextResponse } from "next/server";
import { LIMITS } from "../../../../../../../lib/config";
import { assertGitHubSegment } from "../../../../../../../lib/github-url";

export const runtime = "edge";
const SHA = /^[a-f0-9]{40}$/;

export async function GET(_request: NextRequest, context: { params: Promise<{ owner: string; repo: string; sha: string }> }) {
  try {
    const { owner, repo, sha } = await context.params;
    assertGitHubSegment(owner, "owner"); assertGitHubSegment(repo, "repository");
    if (!SHA.test(sha)) throw new Error("Invalid commit SHA.");
    const upstream = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${sha}`, { redirect: "follow", headers: { Accept: "application/vnd.github+json", "User-Agent": "Repo-Inspector", "X-GitHub-Api-Version": "2022-11-28" } });
    if (upstream.status === 403 && upstream.headers.get("x-ratelimit-remaining") === "0") return NextResponse.json({ error: "GitHub rate limit reached. Try again later." }, { status: 429 });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: `Archive download failed (${upstream.status}).` }, { status: upstream.status || 502 });
    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (declared > LIMITS.compressedArchiveBytes) return NextResponse.json({ error: "Repository archive exceeds the 20 MB MVP limit." }, { status: 413 });
    let received = 0;
    const limiter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > LIMITS.compressedArchiveBytes) return controller.error(new Error("Archive exceeded the 20 MB limit."));
        controller.enqueue(chunk);
      },
    });
    return new Response(upstream.body.pipeThrough(limiter), { headers: { "Content-Type": "application/zip", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Archive request failed." }, { status: 400 });
  }
}

