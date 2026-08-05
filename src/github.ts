import { requestUrl } from "obsidian";

export interface RepoInfo {
  name: string;
  fullName: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  pushedAt: string;
  isPrivate: boolean;
}

export interface CommitItem {
  repo: string;
  message: string;
  when: string;
  /** YYYY-MM-DD — lets callers filter to a specific day without parsing `when`. */
  day: string;
}

/** A non-push thing that happened on a given day (PR opened/merged, tag, release, issue). */
export interface DayEvent {
  kind: string;
  detail: string;
  url: string;
}

export interface RepoCommits {
  repo: string;
  count: number;
}

export interface PullItem {
  repo: string;
  number: number;
  title: string;
  url: string;
  ageDays: number;
  draft: boolean;
}

export interface IssueItem {
  repo: string;
  number: number;
  title: string;
  url: string;
  ageDays: number;
}

export interface RepoHealth {
  repo: string;
  status: "success" | "failure" | "running" | "none";
  url: string;
  when: string;
}

export interface GitHubData {
  name: string;
  publicRepos: number;
  followers: number;
  totalStars: number;
  commits30d: number;
  commits14d: number;
  repos: RepoInfo[];
  commitsByDay: { date: string; label: string; count: number }[];
  commitsByRepo: RepoCommits[];
  recent: CommitItem[];
  /** Every commit pushed today, uncapped — `recent` is trimmed for display. */
  todayCommits: CommitItem[];
  /** Today's PR / release / tag / issue activity. */
  todayEvents: DayEvent[];
  openPRs: PullItem[];
  openIssues: IssueItem[];
  health: RepoHealth[];
  releases14d: number;
  streakDays: number;
  activeDays30: number;
  privateRepos: number;
  /** True when a token was supplied, so private repos/activity are in scope. */
  authenticated: boolean;
}

let cache: { key: string; at: number; data: GitHubData } | null = null;
const TTL = 5 * 60 * 1000;

/** Cached wrapper so the Today snapshot and Dev tab share one round trip. */
export async function getGitHubData(
  username: string,
  token: string,
  force = false
): Promise<GitHubData> {
  const key = `${username}|${token ? "t" : ""}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) {
    return cache.data;
  }
  const data = await fetchGitHubData(username, token);
  cache = { key, at: Date.now(), data };
  return data;
}

/**
 * Pull profile, repos, and activity for the dashboard.
 *
 * Private repositories only appear when a token is supplied AND we ask the
 * *authenticated* endpoints: `/users/{username}/repos` returns public repos
 * only, no matter what token is attached. With a token we therefore use
 * `/user` and `/user/repos`, which include private repos the token can see.
 * `/users/{username}/events` already includes private events when
 * authenticated as that user (fine-grained tokens need the "Events" permission).
 */
export async function fetchGitHubData(username: string, token: string): Promise<GitHubData> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const gh = async (path: string): Promise<any> => {
    const res = await requestUrl({ url: `https://api.github.com${path}`, headers, throw: false });
    if (res.status >= 400) {
      throw new Error(`GitHub ${res.status}: ${res.json?.message ?? "request failed"}`);
    }
    return res.json;
  };

  // search + actions endpoints are rate-limited harder than the rest; a failure
  // there should degrade that panel, never the whole Dev tab
  const soft = <T,>(pr: Promise<T>, fallback: T): Promise<T> => pr.catch(() => fallback);

  // authenticated endpoints see private repos; the /users/... ones never do.
  // A token that is expired or missing a permission shouldn't blank the whole
  // tab, so each authenticated call falls back to its public equivalent.
  const authenticated = !!token;
  const publicProfile = `/users/${username}`;
  const publicRepoList = `/users/${username}/repos?sort=pushed&per_page=100&type=owner`;
  const profileReq = authenticated ? gh(`/user`).catch(() => gh(publicProfile)) : gh(publicProfile);
  const reposReq = authenticated
    ? gh(
        `/user/repos?visibility=all&affiliation=owner,organization_member&sort=pushed&per_page=100`
      ).catch(() => gh(publicRepoList))
    : gh(publicRepoList);

  const [user, repos, page1, page2, prSearch, issueSearch] = await Promise.all([
    profileReq,
    reposReq,
    gh(`/users/${username}/events?per_page=100`),
    soft(gh(`/users/${username}/events?per_page=100&page=2`), []),
    soft(
      gh(`/search/issues?q=${encodeURIComponent(`is:pr is:open author:${username}`)}&per_page=20&sort=created`),
      { items: [] }
    ),
    soft(
      gh(`/search/issues?q=${encodeURIComponent(`is:issue is:open assignee:${username}`)}&per_page=20&sort=created`),
      { items: [] }
    ),
  ]);

  // GitHub's own profile totals when we have them, so PRIVATE + REPOS stay
  // consistent; otherwise count what the repo list actually returned.
  const privateRepos =
    user.total_private_repos ?? (repos as any[]).filter((r: any) => r.private).length;

  const m = (window as any).moment;
  const pushes = ([...page1, ...page2] as any[]).filter((e) => e.type === "PushEvent");

  const days = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    days.set(m().subtract(i, "days").format("YYYY-MM-DD"), 0);
  }
  const today = m().format("YYYY-MM-DD");
  const recent: CommitItem[] = [];
  const todayCommits: CommitItem[] = [];
  const byRepo = new Map<string, number>();
  let commits30d = 0;
  let commits14d = 0;
  for (const e of pushes) {
    const day = m(e.created_at).format("YYYY-MM-DD");
    const commits = e.payload?.commits ?? [];
    const repo = (e.repo?.name ?? "").split("/").pop() ?? "";
    if (days.has(day)) {
      days.set(day, (days.get(day) ?? 0) + commits.length);
      commits14d += commits.length;
      if (repo) byRepo.set(repo, (byRepo.get(repo) ?? 0) + commits.length);
    }
    if (m().diff(m(e.created_at), "days") <= 30) commits30d += commits.length;
    for (const c of commits) {
      const item: CommitItem = {
        repo,
        message: String(c.message ?? "").split("\n")[0].slice(0, 88),
        when: m(e.created_at).format("M/D HH:mm"),
        day,
      };
      if (recent.length < 12) recent.push(item);
      // the day recap needs every commit, not just the 12 the table shows
      if (day === today) todayCommits.push(item);
    }
  }

  // PRs, releases and tags from today round out "what got done" beyond commits
  const todayEvents: DayEvent[] = [];
  for (const e of [...page1, ...page2] as any[]) {
    if (m(e.created_at).format("YYYY-MM-DD") !== today) continue;
    const repo = (e.repo?.name ?? "").split("/").pop() ?? "";
    const p = e.payload ?? {};
    if (e.type === "PullRequestEvent" && (p.action === "opened" || p.action === "closed")) {
      const merged = !!p.pull_request?.merged;
      todayEvents.push({
        kind: merged ? "PR merged" : p.action === "opened" ? "PR opened" : "PR closed",
        detail: `${repo} #${p.number} — ${p.pull_request?.title ?? ""}`,
        url: p.pull_request?.html_url ?? "",
      });
    } else if (e.type === "ReleaseEvent" && p.action === "published") {
      todayEvents.push({
        kind: "Release",
        detail: `${repo} ${p.release?.tag_name ?? ""}`,
        url: p.release?.html_url ?? "",
      });
    } else if (e.type === "CreateEvent" && p.ref_type === "tag") {
      todayEvents.push({ kind: "Tag", detail: `${repo} ${p.ref ?? ""}`, url: "" });
    } else if (e.type === "IssuesEvent" && (p.action === "opened" || p.action === "closed")) {
      todayEvents.push({
        kind: p.action === "closed" ? "Issue closed" : "Issue opened",
        detail: `${repo} #${p.issue?.number} — ${p.issue?.title ?? ""}`,
        url: p.issue?.html_url ?? "",
      });
    }
  }

  const repoOf = (u: string) => (u ?? "").split("/repos/")[1]?.split("/").slice(0, 2).join("/") ?? "";
  const ageOf = (iso: string) => Math.max(0, m().diff(m(iso), "days"));

  const openPRs: PullItem[] = ((prSearch as any).items ?? []).map((p: any) => ({
    repo: repoOf(p.repository_url).split("/").pop() ?? "",
    number: p.number,
    title: String(p.title ?? "").slice(0, 90),
    url: p.html_url,
    ageDays: ageOf(p.created_at),
    draft: !!p.draft,
  }));

  const openIssues: IssueItem[] = ((issueSearch as any).items ?? []).map((it: any) => ({
    repo: repoOf(it.repository_url).split("/").pop() ?? "",
    number: it.number,
    title: String(it.title ?? "").slice(0, 90),
    url: it.html_url,
    ageDays: ageOf(it.created_at),
  }));

  // ship cadence: tags pushed in the window (this project releases by tag)
  const releases14d = ([...page1, ...page2] as any[]).filter(
    (e) => e.type === "CreateEvent" && e.payload?.ref_type === "tag" && days.has(m(e.created_at).format("YYYY-MM-DD"))
  ).length;

  // streak of consecutive days with a push, allowing today to be empty so far
  const pushDays = new Set(pushes.map((e: any) => m(e.created_at).format("YYYY-MM-DD")));
  let streakDays = 0;
  for (let i = 0; i < 60; i++) {
    const d = m().subtract(i, "days").format("YYYY-MM-DD");
    if (pushDays.has(d)) streakDays++;
    else if (i > 0) break;
  }
  const activeDays30 = [...pushDays].filter((d) => m().diff(m(d, "YYYY-MM-DD"), "days") <= 30).length;

  // CI health for the handful of repos actually being worked on
  const watch = (repos as any[]).slice(0, 4);
  const health: RepoHealth[] = (
    await Promise.all(
      watch.map(async (r: any) => {
        const runs = await soft(gh(`/repos/${r.full_name}/actions/runs?per_page=1`), { workflow_runs: [] });
        const run = (runs as any).workflow_runs?.[0];
        if (!run) return { repo: r.name, status: "none" as const, url: r.html_url, when: "" };
        const status: RepoHealth["status"] =
          run.status !== "completed" ? "running" : run.conclusion === "success" ? "success" : "failure";
        return { repo: r.name, status, url: run.html_url, when: m(run.created_at).fromNow() };
      })
    )
  ).filter((h) => h.status !== "none");

  return {
    authenticated,
    privateRepos,
    todayCommits,
    todayEvents,
    openPRs,
    openIssues,
    health,
    releases14d,
    streakDays,
    activeDays30,
    name: user.name ?? username,
    publicRepos: authenticated
      ? (user.public_repos ?? 0) + (user.total_private_repos ?? 0)
      : (user.public_repos ?? 0),
    followers: user.followers ?? 0,
    totalStars: (repos as any[]).reduce((n, r) => n + (r.stargazers_count ?? 0), 0),
    commits30d,
    commits14d,
    commitsByRepo: [...byRepo.entries()]
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => b.count - a.count),
    repos: (repos as any[]).slice(0, 8).map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      description: r.description ?? "",
      language: r.language ?? "—",
      stars: r.stargazers_count ?? 0,
      pushedAt: m(r.pushed_at).fromNow(),
      isPrivate: !!r.private,
    })),
    commitsByDay: [...days.entries()].map(([date, count]) => ({
      date,
      label: m(date, "YYYY-MM-DD").format("M/D"),
      count,
    })),
    recent,
  };
}

/**
 * The GitHub picture as prose the AI can reason over.
 *
 * Deliberately names private repos: the token owner is the only reader, and
 * withholding them would defeat the point of authenticating in the first place.
 */
export function githubContext(gh: GitHubData): string {
  const lines: string[] = [];
  lines.push(`### GitHub activity for ${gh.name}`);
  lines.push(
    `Repos: ${gh.publicRepos} total${gh.authenticated ? ` (${gh.privateRepos} private)` : " (public only — no token set)"}` +
      ` · ${gh.totalStars} stars · commits: ${gh.commits14d} in 14d, ${gh.commits30d} in 30d` +
      ` · ${gh.streakDays}-day push streak · ${gh.activeDays30} active days in 30d · ${gh.releases14d} releases in 14d`
  );

  if (gh.repos.length) {
    lines.push("\nMost recently pushed repos:");
    for (const r of gh.repos) {
      lines.push(
        `- ${r.name}${r.isPrivate ? " (private)" : ""} — ${r.language}, pushed ${r.pushedAt}` +
          `${r.description ? `: ${r.description}` : ""}`
      );
    }
  }

  if (gh.commitsByRepo.length) {
    lines.push(
      `\nCommits per repo (14d): ${gh.commitsByRepo.map((r) => `${r.repo} ${r.count}`).join(", ")}`
    );
  }

  if (gh.openPRs.length) {
    lines.push("\nOpen pull requests:");
    for (const p of gh.openPRs) {
      lines.push(`- ${p.repo} #${p.number} — ${p.title} (${p.ageDays}d old${p.draft ? ", draft" : ""})`);
    }
  }

  if (gh.openIssues.length) {
    lines.push("\nIssues assigned to them:");
    for (const it of gh.openIssues) {
      lines.push(`- ${it.repo} #${it.number} — ${it.title} (${it.ageDays}d old)`);
    }
  }

  if (gh.health.length) {
    lines.push(
      `\nLatest CI run per repo: ${gh.health.map((h) => `${h.repo} ${h.status}`).join(", ")}`
    );
  }

  if (gh.recent.length) {
    lines.push("\nRecent commits:");
    for (const c of gh.recent) lines.push(`- [${c.when}] ${c.repo}: ${c.message}`);
  }

  return lines.join("\n");
}

/** Just today's GitHub output, for the day recap. */
export function githubDayContext(gh: GitHubData): string {
  const lines = [`### GitHub — today`];
  if (!gh.authenticated) {
    lines.push("(No token set, so private repo work is not visible here.)");
  }
  if (gh.todayCommits.length === 0 && gh.todayEvents.length === 0) {
    lines.push("No commits pushed and no PR/release activity recorded today.");
    return lines.join("\n");
  }
  if (gh.todayCommits.length) {
    const byRepo = new Map<string, string[]>();
    for (const c of gh.todayCommits) {
      if (!byRepo.has(c.repo)) byRepo.set(c.repo, []);
      byRepo.get(c.repo)!.push(c.message);
    }
    lines.push(`${gh.todayCommits.length} commits pushed across ${byRepo.size} repo(s):`);
    for (const [repo, msgs] of byRepo) {
      lines.push(`\n**${repo}** (${msgs.length}):`);
      for (const msg of msgs) lines.push(`- ${msg}`);
    }
  }
  if (gh.todayEvents.length) {
    lines.push("\nOther activity today:");
    for (const e of gh.todayEvents) lines.push(`- ${e.kind}: ${e.detail}`);
  }
  return lines.join("\n");
}
