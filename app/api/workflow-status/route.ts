import { NextResponse } from "next/server";
import { getGithubConfig, githubHeaders } from "@/lib/github-workflow";

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface JobStep {
  name: string;
  status: string;
}

interface Job {
  name: string;
  status: string;
  conclusion: string | null;
  steps?: JobStep[];
}

/**
 * GET /api/workflow-status?since=ISO8601
 * Returns the newest workflow run for update-data.yml on main created at/after `since`,
 * plus optional current job step from GitHub Jobs API.
 */
export async function GET(request: Request) {
  const cfg = getGithubConfig();
  if (!cfg) {
    return NextResponse.json({ error: "GITHUB_TOKEN is not configured" }, { status: 501 });
  }

  const { searchParams } = new URL(request.url);
  const sinceRaw = searchParams.get("since");
  if (!sinceRaw) {
    return NextResponse.json({ error: "Query ?since= (ISO8601) is required" }, { status: 400 });
  }

  const sinceMs = new Date(sinceRaw).getTime();
  if (Number.isNaN(sinceMs)) {
    return NextResponse.json({ error: "Invalid since date" }, { status: 400 });
  }

  const listUrl = new URL(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${cfg.workflowId}/runs`
  );
  listUrl.searchParams.set("branch", "main");
  listUrl.searchParams.set("per_page", "15");

  const listRes = await fetch(listUrl.toString(), {
    headers: githubHeaders(cfg.token),
    cache: "no-store",
  });

  if (!listRes.ok) {
    const text = await listRes.text();
    return NextResponse.json(
      { error: "GitHub list runs failed", details: text.slice(0, 400) },
      { status: 502 }
    );
  }

  const listData = (await listRes.json()) as { workflow_runs?: WorkflowRun[] };
  const runs = listData.workflow_runs ?? [];

  const matching = runs
    .filter((r) => new Date(r.created_at).getTime() >= sinceMs - 2000)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const run = matching[0];
  if (!run) {
    return NextResponse.json({
      found: false,
      phase: "waiting",
      label: "Đang chờ GitHub tạo run…",
    });
  }

  let stepHint: string | null = null;
  if (run.status === "queued") {
    stepHint = "Đang xếp hàng chờ runner…";
  } else if (run.status === "in_progress" || run.status === "waiting") {
    const jobsUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/runs/${run.id}/jobs`;
    const jobsRes = await fetch(jobsUrl, {
      headers: githubHeaders(cfg.token),
      cache: "no-store",
    });
    if (jobsRes.ok) {
      const jobsData = (await jobsRes.json()) as { jobs?: Job[] };
      const jobs = jobsData.jobs ?? [];
      const job =
        jobs.find((j) => j.status === "in_progress" || j.status === "queued") ?? jobs[0];
      if (job?.steps?.length) {
        const active = job.steps.find((s) => s.status === "in_progress");
        const pending = job.steps.find((s) => s.status === "queued" || s.status === "pending");
        const lastDone = [...job.steps].reverse().find((s) => s.status === "completed");
        stepHint =
          active?.name ?? pending?.name ?? (lastDone ? `✓ ${lastDone.name}` : job.name) ?? null;
      } else if (job) {
        stepHint = job.name;
      }
    }
    if (!stepHint) stepHint = "Đang chạy workflow…";
  }

  const label =
    run.status === "completed"
      ? run.conclusion === "success"
        ? "Hoàn thành thành công."
        : run.conclusion === "failure"
          ? "Workflow thất bại."
          : `Kết thúc: ${run.conclusion ?? "unknown"}`
      : (stepHint ?? run.status);

  return NextResponse.json({
    found: true,
    runId: run.id,
    status: run.status,
    conclusion: run.conclusion,
    html_url: run.html_url,
    created_at: run.created_at,
    updated_at: run.updated_at,
    phase:
      run.status === "completed" ? "done" : run.status === "queued" ? "queued" : "running",
    label,
    stepName: stepHint,
  });
}
