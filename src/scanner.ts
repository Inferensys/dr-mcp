import os from "node:os";
import path from "node:path";
import type { ScanOptions, ScanReport } from "./types.js";
import { discoverConfigFiles } from "./discover.js";
import { normalizeServers } from "./normalize.js";
import { checkPackageRegistry } from "./registry.js";
import { contextRisk, estimateToolCount, runDiagnostics, scoreDiagnostics } from "./checks.js";
import { generatePatchPlans } from "./patch.js";

export async function scanMcpSetup(options: Partial<ScanOptions> = {}): Promise<ScanReport> {
  const scanOptions: ScanOptions = {
    workspace: path.resolve(options.workspace || process.cwd()),
    homeDir: options.homeDir || os.homedir(),
    registry: Boolean(options.registry),
    includeGlobal: options.includeGlobal !== false,
    redact: options.redact !== false
  };
  const configs = await discoverConfigFiles(scanOptions);
  const servers = normalizeServers(configs);
  const registryFindings = scanOptions.registry ? await checkPackageRegistry(servers) : [];
  const diagnostics = await runDiagnostics(configs, servers, registryFindings, scanOptions);
  const score = scoreDiagnostics(diagnostics);
  const estimatedToolCount = estimateToolCount(servers);
  const duplicateServerCount = countDuplicateServers(servers);
  return {
    generatedAt: new Date().toISOString(),
    workspace: scanOptions.workspace,
    registryEnabled: Boolean(scanOptions.registry),
    score,
    summary: {
      configFiles: configs.filter((config) => config.exists).length,
      parsedConfigFiles: configs.filter((config) => config.exists && !config.parseError).length,
      serverCount: servers.length,
      enabledServerCount: servers.filter((server) => !server.disabled).length,
      duplicateServerCount,
      estimatedToolCount,
      contextRisk: contextRisk(estimatedToolCount)
    },
    configs,
    servers,
    registryFindings,
    diagnostics,
    patchPlans: generatePatchPlans(diagnostics, servers, registryFindings)
  };
}

function countDuplicateServers(servers: Array<{ name: string; disabled?: boolean }>): number {
  const counts = new Map<string, number>();
  for (const server of servers.filter((item) => !item.disabled)) {
    counts.set(server.name, (counts.get(server.name) || 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}
