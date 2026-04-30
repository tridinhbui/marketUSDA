import { NextResponse } from "next/server";
import { getGithubConfig, githubHeaders } from "@/lib/github-workflow";

/**
 * POST — triggers GitHub Actions workflow_dispatch for update-data.yml
 *
 * Response includes `pollSince` — pass to GET /api/workflow-status?since= for progress polling.
 */
export async function POST() {
  const cfg = getGithubConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error: "GITHUB_TOKEN is not configured",
        hint: "Add GITHUB_TOKEN in Vercel project Settings → Environment Variables.",
      },
      { status: 501 }
    );
  }

  // Slightly early so clock skew / run creation delay still matches this run
  const pollSince = new Date(Date.now() - 10_000).toISOString();

  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${cfg.workflowId}/dispatches`;

  const ghRes = await fetch(url, {
    method: "POST",
    headers: {
      ...githubHeaders(cfg.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (!ghRes.ok) {
    const text = await ghRes.text();
    return NextResponse.json(
      {
        error: "GitHub API error",
        status: ghRes.status,
        details: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    pollSince,
    message:
      "Đã gửi workflow. Theo dõi tiến độ bên dưới; khi xong hãy “Làm mới dữ liệu” hoặc đợi Vercel deploy.",
  });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
