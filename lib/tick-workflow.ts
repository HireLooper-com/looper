// The GitHub Actions workflow a self-hosted Vercel install adds to its own repo: Vercel Hobby only runs
// the daily cron in vercel.json, so this calls the scheduler every 15 minutes. Settings > Scheduler opens
// it as a new file in the repo. It never ships in .github/workflows (oss/split.md).
export function tickWorkflow(url: string) {
  return `# Calls the Looper scheduler every 15 minutes. Needs the CRON_SECRET Actions secret from Looper Settings > Scheduler.
name: Tick

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 6
    steps:
      - name: Call the scheduler
        env:
          SECRET: \${{ secrets.CRON_SECRET }}
        run: |
          if [ -z "$SECRET" ]; then echo "Add the CRON_SECRET secret to turn this on."; exit 0; fi
          curl -fsS -m 300 -H "authorization: Bearer $SECRET" "${url}/api/cron/tick"
`;
}

/** Links for Settings > Scheduler, on a self-hosted install deployed from GitHub to Vercel; null anywhere else. */
export function tickSetup() {
  const { VERCEL_GIT_PROVIDER: git, VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: repo, VERCEL_PROJECT_PRODUCTION_URL: host } = process.env;
  if (git !== "github" || !owner || !repo || !host) return null;
  const base = `https://github.com/${owner}/${repo}`;
  const yml = tickWorkflow(`https://${host}`);
  return {
    repo: `${owner}/${repo}`,
    workflow: `${base}/new/${process.env.VERCEL_GIT_COMMIT_REF || "main"}?filename=${encodeURIComponent(".github/workflows/tick.yml")}&value=${encodeURIComponent(yml)}`,
    secret: `${base}/settings/secrets/actions/new`,
    runs: `${base}/actions/workflows/tick.yml`,
  };
}
