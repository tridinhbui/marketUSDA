import { NextResponse } from "next/server";

/**
 * POST — triggers GitHub Actions workflow_dispatch for update-data.yml
 *
 * Env (Vercel):
 *   GITHUB_TOKEN — fine-grained PAT with Actions: Write, or classic PAT with `workflow`
 *   GITHUB_OWNER / GITHUB_REPO — optional (defaults tridinhbui / marketUSDA)
 *
 * Confirmation is done in the UI (user must type CONFIRM); not a server secret.
 */
export async function POST() {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error: "GITHUB_TOKEN is not configured",
        hint: "Add GITHUB_TOKEN in Vercel project Settings → Environment Variables.",
      },
      { status: 501 }
    );
  }

  const owner = process.env.GITHUB_OWNER?.trim() || "tridinhbui";
  const repo = process.env.GITHUB_REPO?.trim() || "marketUSDA";
  const workflow_id = "update-data.yml";

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`;

  const ghRes = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
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
    message: "Workflow “Update USDA data” dispatched. Wait 2–5 minutes, then use “Làm mới dữ liệu” or redeploy.",
  });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
