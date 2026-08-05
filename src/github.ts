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
}

export interface RepoCommits {
  repo: string;
  count: number;
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

/** Pull profile, repos, and push activity for the dashboard. Token optional
 *  (raises rate limits and includes private repo activity for your own user). */
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

  const [user, repos, page1, page2] = await Promise.all([
    gh(`/users/${username}`),
    gh(`/users/${username}/repos?sort=pushed&per_page=100&type=owner`),
    gh(`/users/${username}/events?per_page=100`),
    gh(`/users/${username}/events?per_page=100&page=2`).catch(() => []),
  ]);

  const m = (window as any).moment;
  const pushes = ([...page1, ...page2] as any[]).filter((e) => e.type === "PushEvent");

  const days = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    days.set(m().subtract(i, "days").format("YYYY-MM-DD"), 0);
  }
  const recent: CommitItem[] = [];
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
      if (recent.length >= 12) break;
      recent.push({
        repo,
        message: String(c.message ?? "").split("\n")[0].slice(0, 88),
        when: m(e.created_at).format("M/D HH:mm"),
      });
    }
  }

  return {
    name: user.name ?? username,
    publicRepos: user.public_repos ?? 0,
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
