import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphql } from '@octokit/graphql';
import yaml from 'js-yaml';
import {
  ConfigSchema,
  DatasetSchema,
  type Config,
  type Dataset,
  type Event,
  type EventType,
} from '../src/types';

type LoadedConfig = {
  repos: string[];
  funds: Record<string, string[]>;
};

const WINDOW_DAYS = 90;
const COMMITS_PER_REPO = 100;
const PRS_PER_REPO = 50;
const ISSUES_PER_REPO = 50;
const RELEASES_PER_REPO = 20;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE_PATTERN = /^repos(\..+)?\.ya?ml$/i;
const OUT_PATH = resolve(ROOT, 'public/data/events.json');

type Actor = { login: string } | null;
type CommitNode = {
  oid: string;
  abbreviatedOid: string;
  committedDate: string;
  messageHeadline: string;
  url: string;
  author: { user: Actor; name: string | null } | null;
};
type PrNode = {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  merged: boolean;
  author: Actor;
  mergedBy: Actor;
};
type IssueNode = {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  closedAt: string | null;
  author: Actor;
};
type ReleaseNode = {
  tagName: string;
  name: string | null;
  url: string;
  publishedAt: string | null;
  createdAt: string;
  author: Actor;
};
type RepoQueryResult = {
  repository: {
    nameWithOwner: string;
    defaultBranchRef: { target: { history: { nodes: CommitNode[] } } } | null;
    pullRequests: { nodes: PrNode[] };
    issues: { nodes: IssueNode[] };
    releases: { nodes: ReleaseNode[] };
  } | null;
};

const REPO_QUERY = /* GraphQL */ `
  query Repo(
    $owner: String!
    $name: String!
    $commits: Int!
    $prs: Int!
    $issues: Int!
    $releases: Int!
  ) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: $commits) {
              nodes {
                oid
                abbreviatedOid
                committedDate
                messageHeadline
                url
                author {
                  name
                  user {
                    login
                  }
                }
              }
            }
          }
        }
      }
      pullRequests(first: $prs, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          url
          createdAt
          mergedAt
          closedAt
          merged
          author {
            login
          }
          mergedBy {
            login
          }
        }
      }
      issues(first: $issues, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          url
          createdAt
          closedAt
          author {
            login
          }
        }
      }
      releases(first: $releases, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          tagName
          name
          url
          publishedAt
          createdAt
          author {
            login
          }
        }
      }
    }
  }
`;

type EventInput = {
  repo: string;
  type: EventType;
  nativeId: string;
  timestamp: string;
  actor: string;
  title: string;
  url: string;
  shortId: string;
};

function makeEvent(e: EventInput): Event {
  return {
    id: `${e.repo}:${e.type}:${e.nativeId}`,
    repo: e.repo,
    type: e.type,
    timestamp: e.timestamp,
    actor: e.actor,
    title: e.title,
    url: e.url,
    shortId: e.shortId,
  };
}

const login = (a: Actor) => a?.login ?? 'unknown';

function commitToEvents(repo: string, n: CommitNode): Event[] {
  return [
    makeEvent({
      repo,
      type: 'commit',
      nativeId: n.oid,
      timestamp: n.committedDate,
      actor: n.author?.user?.login ?? n.author?.name ?? 'unknown',
      title: n.messageHeadline,
      url: n.url,
      shortId: n.abbreviatedOid,
    }),
  ];
}

function prToEvents(repo: string, n: PrNode): Event[] {
  const common = {
    repo,
    nativeId: String(n.number),
    title: n.title,
    url: n.url,
    shortId: `#${n.number}`,
  };
  const events: Event[] = [
    makeEvent({ ...common, type: 'pr_opened', timestamp: n.createdAt, actor: login(n.author) }),
  ];
  if (n.merged && n.mergedAt) {
    events.push(
      makeEvent({
        ...common,
        type: 'pr_merged',
        timestamp: n.mergedAt,
        actor: login(n.mergedBy ?? n.author),
      }),
    );
  } else if (n.closedAt) {
    events.push(
      makeEvent({ ...common, type: 'pr_closed', timestamp: n.closedAt, actor: login(n.author) }),
    );
  }
  return events;
}

function issueToEvents(repo: string, n: IssueNode): Event[] {
  const common = {
    repo,
    nativeId: String(n.number),
    title: n.title,
    url: n.url,
    shortId: `#${n.number}`,
    actor: login(n.author),
  };
  const events: Event[] = [makeEvent({ ...common, type: 'issue_opened', timestamp: n.createdAt })];
  if (n.closedAt)
    events.push(makeEvent({ ...common, type: 'issue_closed', timestamp: n.closedAt }));
  return events;
}

function releaseToEvents(repo: string, n: ReleaseNode): Event[] {
  return [
    makeEvent({
      repo,
      type: 'release',
      nativeId: n.tagName,
      timestamp: n.publishedAt ?? n.createdAt,
      actor: login(n.author),
      title: n.name ?? n.tagName,
      url: n.url,
      shortId: n.tagName,
    }),
  ];
}

function fundFromFilename(file: string): string {
  const m = file.match(/^repos\.(.+)\.ya?ml$/i);
  return m ? m[1].toLowerCase() : 'general';
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

async function githubJson<T>(token: string, pathAndQuery: string): Promise<T> {
  const res = await fetch(`https://api.github.com${pathAndQuery}`, {
    headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${pathAndQuery}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Every public `owner/name` under orgs from GET /user/orgs (GET /orgs/{org}/repos?type=public). */
async function listAllOrgRepos(token: string): Promise<string[]> {
  type Org = { login: string };
  type Repo = { full_name: string };
  const orgs: Org[] = [];
  let orgPage = 1;
  while (true) {
    const chunk = await githubJson<Org[]>(token, `/user/orgs?per_page=100&page=${orgPage}`);
    if (chunk.length === 0) break;
    orgs.push(...chunk);
    if (chunk.length < 100) break;
    orgPage++;
  }

  const names = new Set<string>();
  for (const { login: org } of orgs) {
    let repoPage = 1;
    while (true) {
      const repos = await githubJson<Repo[]>(
        token,
        `/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${repoPage}&type=public&sort=full_name`,
      );
      if (repos.length === 0) break;
      for (const r of repos) names.add(r.full_name);
      if (repos.length < 100) break;
      repoPage++;
    }
  }
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

async function loadConfig(token: string): Promise<LoadedConfig> {
  const files = (await readdir(ROOT)).filter((f) => CONFIG_FILE_PATTERN.test(f)).sort();
  if (files.length === 0) {
    throw new Error('No repos.yml or repos.<group>.yml files found at the project root.');
  }
  const parsedFiles: { file: string; parsed: Config }[] = [];
  let anyOrgExpand = false;
  for (const file of files) {
    const raw = await readFile(resolve(ROOT, file), 'utf8');
    const parsed = ConfigSchema.parse(yaml.load(raw));
    parsedFiles.push({ file, parsed });
    if (parsed.include_all_org_repos) anyOrgExpand = true;
  }

  let orgRepos: string[] = [];
  if (anyOrgExpand) {
    console.log('  (listing public repos from your GitHub organizations...)');
    orgRepos = await listAllOrgRepos(token);
    console.log(`  -> ${orgRepos.length} org repo(s) total`);
  }

  const all = new Set<string>();
  const funds: Record<string, Set<string>> = {};
  for (const { file, parsed } of parsedFiles) {
    const fundName = parsed.fund ?? fundFromFilename(file);
    const extra = parsed.include_all_org_repos ? orgRepos.length : 0;
    console.log(
      `  ${file}: ${parsed.repos.length} repos${extra ? ` + ${extra} from orgs` : ''} -> "${fundName}"`,
    );
    const bucket = (funds[fundName] ??= new Set<string>());
    for (const r of parsed.repos) {
      all.add(r);
      bucket.add(r);
    }
    if (parsed.include_all_org_repos) {
      for (const r of orgRepos) {
        all.add(r);
        bucket.add(r);
      }
    }
  }

  if (all.size === 0) {
    throw new Error('No repositories to fetch: add repos in repos*.yml or enable include_all_org_repos.');
  }

  return {
    repos: [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    funds: Object.fromEntries(
      Object.entries(funds).map(([k, v]) => [
        k,
        [...v].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      ]),
    ),
  };
}

function getToken(): string {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to run the fetcher.');
  }
  return token;
}

async function fetchRepo(client: typeof graphql, ownerName: string): Promise<Event[]> {
  const [owner, name] = ownerName.split('/');
  const data = await client<RepoQueryResult>(REPO_QUERY, {
    owner,
    name,
    commits: COMMITS_PER_REPO,
    prs: PRS_PER_REPO,
    issues: ISSUES_PER_REPO,
    releases: RELEASES_PER_REPO,
  });
  const repo = data.repository;
  if (!repo) {
    console.warn(`! ${ownerName}: not found or inaccessible, skipping`);
    return [];
  }
  const commits = repo.defaultBranchRef?.target.history.nodes ?? [];
  return [
    ...commits.flatMap((n) => commitToEvents(ownerName, n)),
    ...repo.pullRequests.nodes.flatMap((n) => prToEvents(ownerName, n)),
    ...repo.issues.nodes.flatMap((n) => issueToEvents(ownerName, n)),
    ...repo.releases.nodes.flatMap((n) => releaseToEvents(ownerName, n)),
  ];
}

async function main() {
  const token = getToken();
  const config = await loadConfig(token);
  const client = graphql.defaults({ headers: { authorization: `token ${token}` } });
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;

  console.log(`Fetching ${config.repos.length} repo(s), window=${WINDOW_DAYS}d`);

  const all: Event[] = [];
  for (const repo of config.repos) {
    try {
      const events = await fetchRepo(client, repo);
      const recent = events.filter((e) => Date.parse(e.timestamp) >= cutoff);
      console.log(`  ${repo}: ${recent.length} events (of ${events.length} fetched)`);
      all.push(...recent);
    } catch (err) {
      console.error(`! ${repo}: ${(err as Error).message}`);
    }
  }

  all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    repos: config.repos,
    funds: config.funds,
    events: all,
  };
  DatasetSchema.parse(dataset);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n');
  console.log(`Wrote ${all.length} events -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
