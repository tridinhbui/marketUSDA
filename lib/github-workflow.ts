export const WORKFLOW_FILE = "update-data.yml";

export function getGithubConfig():
  | {
      token: string;
      owner: string;
      repo: string;
      workflowId: string;
    }
  | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    owner: process.env.GITHUB_OWNER?.trim() || "tridinhbui",
    repo: process.env.GITHUB_REPO?.trim() || "marketUSDA",
    workflowId: WORKFLOW_FILE,
  };
}

export function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };
}
