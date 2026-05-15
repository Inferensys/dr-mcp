import type { NormalizedServer, RegistryFinding, RepositoryActivity } from "./types.js";

export async function checkPackageRegistry(servers: NormalizedServer[]): Promise<RegistryFinding[]> {
  const packageServers = servers.filter((server) => server.packageName && !server.disabled);
  const packageNames = [...new Set(packageServers.map((server) => server.packageName as string))];
  const metadata = new Map<
    string,
    {
      latest?: string;
      mcpName?: string;
      officialListed?: boolean;
      repository?: RepositoryActivity;
      missing?: boolean;
      error?: string;
    }
  >();
  await Promise.all(
    packageNames.map(async (packageName) => {
      try {
        const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
          headers: { accept: "application/json" }
        });
        if (response.status === 404) {
          metadata.set(packageName, { missing: true });
          return;
        }
        if (!response.ok) {
          metadata.set(packageName, { error: `npm returned ${response.status}` });
          return;
        }
        const body = (await response.json()) as {
          "dist-tags"?: { latest?: string };
          repository?: PackageRepository;
          versions?: Record<string, { mcpName?: string; repository?: PackageRepository }>;
        };
        const latest = body["dist-tags"]?.latest;
        if (!latest) {
          metadata.set(packageName, { error: "npm metadata did not include dist-tags.latest" });
          return;
        }
        const latestVersion = body.versions?.[latest];
        const mcpName = latestVersion?.mcpName;
        const officialListed = mcpName ? await isOfficialRegistryListed(mcpName) : undefined;
        const repositoryUrl = normalizeRepositoryUrl(latestVersion?.repository || body.repository);
        const repository = repositoryUrl ? await checkRepositoryActivity(repositoryUrl) : undefined;
        metadata.set(packageName, { latest, mcpName, officialListed, repository });
      } catch (error) {
        metadata.set(packageName, { error: error instanceof Error ? error.message : String(error) });
      }
    })
  );

  return packageServers.map((server) => {
    const packageName = server.packageName as string;
    const found = metadata.get(packageName);
    if (!found || found.error) {
      return {
        serverId: server.id,
        packageName,
        installedVersion: server.packageVersion,
        status: "unknown",
        message: found?.error || "Package metadata could not be checked"
      };
    }
    if (found.missing) {
      return {
        serverId: server.id,
        packageName,
        installedVersion: server.packageVersion,
        status: "missing",
        message: "Package was not found in the public npm registry"
      };
    }
    if (server.packageVersion && server.packageVersion !== "latest" && found.latest && server.packageVersion !== found.latest) {
      return {
        serverId: server.id,
        packageName,
        installedVersion: server.packageVersion,
        latestVersion: found.latest,
        mcpName: found.mcpName,
        repository: found.repository,
        status: "stale",
        message: `Package is pinned to ${server.packageVersion}; latest is ${found.latest}`
      };
    }
    if (found.mcpName && found.officialListed === false) {
      return {
        serverId: server.id,
        packageName,
        installedVersion: server.packageVersion,
        latestVersion: found.latest,
        mcpName: found.mcpName,
        repository: found.repository,
        status: "registry-mismatch",
        message: `Package declares mcpName "${found.mcpName}", but that server was not found in the official MCP Registry`
      };
    }
    return {
      serverId: server.id,
      packageName,
      installedVersion: server.packageVersion,
      latestVersion: found.latest,
      mcpName: found.mcpName,
      repository: found.repository,
      status: "ok",
      message: "Package exists in the public npm registry"
    };
  });
}

interface PackageRepository {
  type?: string;
  url?: string;
}

async function isOfficialRegistryListed(mcpName: string): Promise<boolean | undefined> {
  try {
    const response = await fetch(
      `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(mcpName)}`,
      { headers: { accept: "application/json" } }
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { servers?: Array<{ server?: { name?: string } }> };
    return Boolean(body.servers?.some((entry) => entry.server?.name === mcpName));
  } catch {
    return undefined;
  }
}

function normalizeRepositoryUrl(repository?: string | PackageRepository): string | undefined {
  const value = typeof repository === "string" ? repository : repository?.url;
  if (!value) return undefined;
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^git\+/, "");
  cleaned = cleaned.replace(/^git:\/\//, "https://");
  cleaned = cleaned.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  cleaned = cleaned.replace(/^git@github\.com:/, "https://github.com/");
  cleaned = cleaned.replace(/\.git(#.*)?$/, "");
  return cleaned.startsWith("http://") || cleaned.startsWith("https://") ? cleaned : undefined;
}

async function checkRepositoryActivity(repositoryUrl: string): Promise<RepositoryActivity> {
  const github = parseGitHubRepository(repositoryUrl);
  if (!github) {
    return {
      url: repositoryUrl,
      host: "unknown",
      status: "unknown",
      message: "Repository host is not supported for activity checks"
    };
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${github.owner}/${github.repo}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "mcp-doctor"
      }
    });
    if (!response.ok) {
      return {
        url: repositoryUrl,
        host: "github",
        owner: github.owner,
        repo: github.repo,
        status: "unknown",
        message: `GitHub repository metadata returned ${response.status}`
      };
    }
    const body = (await response.json()) as {
      pushed_at?: string;
      archived?: boolean;
      disabled?: boolean;
      stargazers_count?: number;
      open_issues_count?: number;
    };
    const daysSincePush = body.pushed_at ? daysSince(body.pushed_at) : undefined;
    const status = repoStatus(Boolean(body.archived), daysSincePush);
    return {
      url: repositoryUrl,
      host: "github",
      owner: github.owner,
      repo: github.repo,
      archived: Boolean(body.archived),
      disabled: Boolean(body.disabled),
      stars: body.stargazers_count,
      openIssues: body.open_issues_count,
      lastPushedAt: body.pushed_at,
      daysSincePush,
      status,
      message: repoMessage(status, daysSincePush)
    };
  } catch (error) {
    return {
      url: repositoryUrl,
      host: "github",
      owner: github.owner,
      repo: github.repo,
      status: "unknown",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseGitHubRepository(repositoryUrl: string): { owner: string; repo: string } | undefined {
  try {
    const url = new URL(repositoryUrl);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return undefined;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return undefined;
  }
}

function repoStatus(archived: boolean, daysSincePush: number | undefined): RepositoryActivity["status"] {
  if (archived) return "archived";
  if (daysSincePush === undefined) return "unknown";
  if (daysSincePush >= 365) return "abandoned";
  if (daysSincePush >= 180) return "quiet";
  return "active";
}

function repoMessage(status: RepositoryActivity["status"], daysSincePush: number | undefined): string {
  if (status === "archived") return "Repository is archived";
  if (status === "abandoned") return `Repository has had no GitHub push activity for ${daysSincePush} days`;
  if (status === "quiet") return `Repository has had no GitHub push activity for ${daysSincePush} days`;
  if (status === "active") return `Repository was pushed within ${daysSincePush} days`;
  return "Repository activity could not be determined";
}

function daysSince(date: string): number {
  const time = Date.parse(date);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}
