import type { NormalizedServer, RegistryFinding } from "./types.js";

export async function checkPackageRegistry(servers: NormalizedServer[]): Promise<RegistryFinding[]> {
  const packageServers = servers.filter((server) => server.packageName && !server.disabled);
  const packageNames = [...new Set(packageServers.map((server) => server.packageName as string))];
  const metadata = new Map<
    string,
    { latest?: string; mcpName?: string; officialListed?: boolean; missing?: boolean; error?: string }
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
          versions?: Record<string, { mcpName?: string }>;
        };
        const latest = body["dist-tags"]?.latest;
        if (!latest) {
          metadata.set(packageName, { error: "npm metadata did not include dist-tags.latest" });
          return;
        }
        const mcpName = body.versions?.[latest]?.mcpName;
        const officialListed = mcpName ? await isOfficialRegistryListed(mcpName) : undefined;
        metadata.set(packageName, { latest, mcpName, officialListed });
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
      status: "ok",
      message: "Package exists in the public npm registry"
    };
  });
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
