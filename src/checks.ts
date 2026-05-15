import path from "node:path";
import type {
  ConfigFile,
  ContextWeightEntry,
  Diagnostic,
  NormalizedServer,
  RegistryFinding,
  ScanOptions,
  ScoreSummary,
  UsageSignal
} from "./types.js";
import { isExecutableOnPath, pathExists } from "./fs-utils.js";
import { containsSecret, isSecretKey } from "./redact.js";

export async function runDiagnostics(
  configs: ConfigFile[],
  servers: NormalizedServer[],
  registryFindings: RegistryFinding[],
  options: ScanOptions,
  usageSignals: UsageSignal[] = []
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...parseDiagnostics(configs));
  diagnostics.push(...duplicateDiagnostics(servers));
  diagnostics.push(...staticServerDiagnostics(servers, options));
  diagnostics.push(...registryDiagnostics(registryFindings, servers));
  diagnostics.push(...toolCountDiagnostics(servers));
  diagnostics.push(...contextWeightDiagnostics(servers));
  diagnostics.push(...usageDiagnostics(usageSignals, servers));
  diagnostics.push(...(await pathDiagnostics(servers, options)));
  return diagnostics;
}

export function scoreDiagnostics(diagnostics: Diagnostic[]): ScoreSummary {
  const base = {
    reliability: 100,
    security: 100,
    contextHygiene: 100,
    maintainability: 100
  };
  const weights = { info: 1, low: 4, medium: 10, high: 20 };
  for (const diagnostic of diagnostics) {
    base[diagnostic.category] = Math.max(0, base[diagnostic.category] - weights[diagnostic.severity]);
  }
  const overall = Math.round(
    base.reliability * 0.3 + base.security * 0.3 + base.contextHygiene * 0.2 + base.maintainability * 0.2
  );
  return { overall, ...base };
}

export function estimateToolCount(servers: NormalizedServer[]): number {
  return servers.filter((server) => !server.disabled).reduce((total, server) => total + estimateServerTools(server), 0);
}

export function contextWeights(servers: NormalizedServer[]): ContextWeightEntry[] {
  return servers
    .filter((server) => !server.disabled)
    .map((server) => {
      const estimatedToolCount = estimateServerTools(server);
      return {
        serverId: server.id,
        serverName: server.name,
        target: server.target,
        sourceFile: server.sourceFile,
        packageName: server.packageName,
        estimatedToolCount,
        weight: contextWeight(estimatedToolCount),
        reasons: contextWeightReasons(server, estimatedToolCount)
      } satisfies ContextWeightEntry;
    })
    .sort((left, right) => right.estimatedToolCount - left.estimatedToolCount);
}

export function contextRisk(estimatedToolCount: number): "low" | "medium" | "high" {
  if (estimatedToolCount >= 80) return "high";
  if (estimatedToolCount >= 40) return "medium";
  return "low";
}

function parseDiagnostics(configs: ConfigFile[]): Diagnostic[] {
  return configs
    .filter((config) => config.exists && config.parseError)
    .map((config) => ({
      id: `parse-error:${config.id}`,
      category: "reliability",
      severity: "high",
      title: "Config file cannot be parsed",
      message: `${config.label} exists but MCP Doctor could not parse it.`,
      target: config.target,
      sourceFile: config.filePath,
      evidence: config.parseError
    }));
}

function duplicateDiagnostics(servers: NormalizedServer[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byName = new Map<string, NormalizedServer[]>();
  for (const server of servers.filter((item) => !item.disabled)) {
    byName.set(server.name, [...(byName.get(server.name) || []), server]);
  }
  for (const [name, matches] of byName.entries()) {
    if (matches.length < 2) continue;
    matches.slice(1).forEach((server, index) => {
      diagnostics.push({
        id: `duplicate-server:${name}:${index + 1}`,
        category: "maintainability",
        severity: "medium",
        title: "Duplicate MCP server name",
        message: `Server "${name}" appears more than once. Duplicate names make client behavior hard to predict.`,
        target: server.target,
        sourceFile: server.sourceFile,
        serverId: server.id,
        serverName: server.name,
        fixPlanId: "remove-duplicate-servers"
      });
    });
  }
  return diagnostics;
}

function staticServerDiagnostics(servers: NormalizedServer[], options: ScanOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const server of servers.filter((item) => !item.disabled)) {
    if (!server.command && !server.url) {
      diagnostics.push({
        id: `missing-launch:${server.id}`,
        category: "reliability",
        severity: "high",
        title: "Server has no launch command or URL",
        message: `Server "${server.name}" cannot be launched because it has neither a command nor a remote URL.`,
        target: server.target,
        sourceFile: server.sourceFile,
        serverId: server.id,
        serverName: server.name,
        fixPlanId: "remove-dead-servers"
      });
    }
    if (server.transport && !["stdio", "http", "sse", "streamable-http"].includes(server.transport)) {
      diagnostics.push({
        id: `unsupported-transport:${server.id}`,
        category: "reliability",
        severity: "medium",
        title: "Unsupported transport value",
        message: `Server "${server.name}" uses transport "${server.transport}", which may not be understood by MCP clients.`,
        target: server.target,
        sourceFile: server.sourceFile,
        serverId: server.id,
        serverName: server.name
      });
    }
    if (server.packageName && (!server.packageVersion || server.packageVersion === "latest")) {
      diagnostics.push({
        id: `unpinned-package:${server.id}`,
        category: "maintainability",
        severity: "medium",
        title: "Unpinned package install",
        message: `Server "${server.name}" installs ${server.packageName} without a fixed version.`,
        target: server.target,
        sourceFile: server.sourceFile,
        serverId: server.id,
        serverName: server.name,
        fixPlanId: options.registry ? "pin-npx-packages" : undefined
      });
    }
    for (const arg of server.args) {
      if (containsSecret(arg)) {
        diagnostics.push({
          id: `secret-arg:${server.id}:${hashish(arg)}`,
          category: "security",
          severity: "high",
          title: "Secret-like value in command arguments",
          message: `Server "${server.name}" appears to include a secret in command arguments.`,
          target: server.target,
          sourceFile: server.sourceFile,
          serverId: server.id,
          serverName: server.name
        });
      }
    }
    for (const [key, value] of Object.entries(server.env)) {
      if (isSecretKey(key) && value && !looksLikeEnvReference(value) && !looksLikePlaceholder(value)) {
        diagnostics.push({
          id: `inline-secret-env:${server.id}:${key}`,
          category: "security",
          severity: "high",
          title: "Inline secret environment value",
          message: `Server "${server.name}" stores ${key} directly in config. Prefer an environment reference or a secret manager.`,
          target: server.target,
          sourceFile: server.sourceFile,
          serverId: server.id,
          serverName: server.name
        });
      }
      if (looksLikeEnvReference(value)) {
        const envName = envReferenceName(value);
        if (envName && process.env[envName] === undefined) {
          diagnostics.push({
            id: `broken-env-reference:${server.id}:${key}`,
            category: "reliability",
            severity: "medium",
            title: "Environment reference is not set",
            message: `Server "${server.name}" references ${envName}, but it is not set in the current environment.`,
            target: server.target,
            sourceFile: server.sourceFile,
            serverId: server.id,
            serverName: server.name
          });
        }
      }
    }
    if (hasBroadFilesystemAccess(server, options)) {
      diagnostics.push({
        id: `broad-filesystem:${server.id}`,
        category: "security",
        severity: "high",
        title: "Broad filesystem access",
        message: `Server "${server.name}" appears to expose a broad filesystem path. Narrow this to project-specific directories.`,
        target: server.target,
        sourceFile: server.sourceFile,
        serverId: server.id,
        serverName: server.name
      });
    }
  }
  return diagnostics;
}

async function pathDiagnostics(servers: NormalizedServer[], options: ScanOptions): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const server of servers.filter((item) => !item.disabled)) {
    if (server.command && !(await isExecutableOnPath(server.command))) {
      diagnostics.push({
        id: `missing-command:${server.id}`,
        category: "reliability",
        severity: "high",
        title: "Launch command was not found",
        message: `Command "${server.command}" for server "${server.name}" was not found on PATH or as a file.`,
        target: server.target,
        sourceFile: server.sourceFile,
        serverId: server.id,
        serverName: server.name,
        evidence: server.command
      });
    }
    for (const arg of server.args.filter(looksLikeLocalFileArgument)) {
      const resolved = path.isAbsolute(arg) ? arg : path.resolve(options.workspace, arg);
      if (!(await pathExists(resolved))) {
        diagnostics.push({
          id: `missing-path:${server.id}:${hashish(arg)}`,
          category: "reliability",
          severity: "medium",
          title: "Referenced local path does not exist",
          message: `Server "${server.name}" references a local path that does not exist.`,
          target: server.target,
          sourceFile: server.sourceFile,
          serverId: server.id,
          serverName: server.name,
          evidence: arg
        });
      }
    }
  }
  return diagnostics;
}

function registryDiagnostics(findings: RegistryFinding[], servers: NormalizedServer[]): Diagnostic[] {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const packageDiagnostics = findings
    .filter(
      (finding) =>
        finding.status === "missing" || finding.status === "stale" || finding.status === "registry-mismatch"
    )
    .map((finding) => {
      const server = byId.get(finding.serverId);
      return {
        id: `registry:${finding.status}:${finding.serverId}`,
        category: finding.status === "missing" ? "reliability" : "maintainability",
        severity: finding.status === "missing" ? "high" : finding.status === "registry-mismatch" ? "medium" : "low",
        title:
          finding.status === "missing"
            ? "Package missing from npm"
            : finding.status === "registry-mismatch"
              ? "Package MCP name is not listed in the official registry"
              : "Package is stale",
        message: finding.message,
        target: server?.target,
        sourceFile: server?.sourceFile,
        serverId: finding.serverId,
        serverName: server?.name,
        fixPlanId:
          finding.status === "stale"
            ? "pin-npx-packages"
            : finding.status === "missing"
              ? "remove-dead-servers"
              : undefined
      } satisfies Diagnostic;
    });
  const repositoryDiagnostics: Diagnostic[] = findings.flatMap((finding): Diagnostic[] => {
    const server = byId.get(finding.serverId);
    const repository = finding.repository;
    if (!repository) return [];
    if (repository.status === "archived") {
      return [
        {
          id: `repository:archived:${finding.serverId}`,
          category: "maintainability",
          severity: "high",
          title: "MCP package repository is archived",
          message: `Server "${server?.name || finding.packageName}" comes from an archived GitHub repository.`,
          target: server?.target,
          sourceFile: server?.sourceFile,
          serverId: finding.serverId,
          serverName: server?.name,
          evidence: repository.url,
          fixPlanId: "remove-abandoned-servers"
        } satisfies Diagnostic
      ];
    }
    if (repository.status === "abandoned") {
      return [
        {
          id: `repository:abandoned:${finding.serverId}`,
          category: "maintainability",
          severity: "medium",
          title: "MCP package repository looks abandoned",
          message: `Server "${server?.name || finding.packageName}" has no GitHub push activity for ${repository.daysSincePush} days.`,
          target: server?.target,
          sourceFile: server?.sourceFile,
          serverId: finding.serverId,
          serverName: server?.name,
          evidence: repository.url,
          fixPlanId: "remove-abandoned-servers"
        } satisfies Diagnostic
      ];
    }
    if (repository.status === "quiet") {
      return [
        {
          id: `repository:quiet:${finding.serverId}`,
          category: "maintainability",
          severity: "low",
          title: "MCP package repository is quiet",
          message: `Server "${server?.name || finding.packageName}" has no GitHub push activity for ${repository.daysSincePush} days.`,
          target: server?.target,
          sourceFile: server?.sourceFile,
          serverId: finding.serverId,
          serverName: server?.name,
          evidence: repository.url
        } satisfies Diagnostic
      ];
    }
    return [];
  });
  return [...packageDiagnostics, ...repositoryDiagnostics];
}

function toolCountDiagnostics(servers: NormalizedServer[]): Diagnostic[] {
  const estimated = estimateToolCount(servers);
  if (estimated < 40) return [];
  return [
    {
      id: "excessive-tool-count",
      category: "contextHygiene",
      severity: estimated >= 80 ? "high" : "medium",
      title: "MCP tool count may overload the client",
      message: `Estimated tool count is ${estimated}. Many clients become less reliable when too many tools are loaded at once.`,
      evidence: `${servers.filter((server) => !server.disabled).length} enabled server(s)`
    }
  ];
}

function contextWeightDiagnostics(servers: NormalizedServer[]): Diagnostic[] {
  return contextWeights(servers)
    .filter((entry) => entry.weight === "heavy" || entry.weight === "extreme")
    .map((entry) => ({
      id: `context-weight:${entry.weight}:${entry.serverId}`,
      category: "contextHygiene",
      severity: entry.weight === "extreme" ? "medium" : "low",
      title: "MCP server is context-heavy",
      message: `Server "${entry.serverName}" is estimated to expose about ${entry.estimatedToolCount} tools. Review whether this belongs in every coding session.`,
      target: entry.target,
      sourceFile: entry.sourceFile,
      serverId: entry.serverId,
      serverName: entry.serverName,
      evidence: entry.reasons.join("; "),
      fixPlanId: "remove-heavy-context-servers"
    }) satisfies Diagnostic);
}

function usageDiagnostics(usageSignals: UsageSignal[], servers: NormalizedServer[]): Diagnostic[] {
  const serverIds = new Set(servers.filter((server) => !server.disabled).map((server) => server.id));
  return usageSignals
    .filter((signal) => signal.status === "long-lived" && serverIds.has(signal.serverId))
    .map((signal) => ({
      id: `usage:long-lived:${signal.serverId}`,
      category: "maintainability",
      severity: "info",
      title: "Long-lived MCP install needs review",
      message: `MCP Doctor has seen "${signal.serverName}" in ${signal.scanCount} tracked scans across ${signal.daysInstalled} days. If you do not use it, consider removing it.`,
      target: signal.target,
      sourceFile: signal.sourceFile,
      serverId: signal.serverId,
      serverName: signal.serverName,
      fixPlanId: "remove-long-lived-servers"
    }));
}

export function estimateServerTools(server: NormalizedServer): number {
  const haystack = `${server.name} ${server.packageName || ""}`.toLowerCase();
  if (haystack.includes("github")) return 80;
  if (haystack.includes("playwright") || haystack.includes("browser")) return 25;
  if (haystack.includes("filesystem") || haystack.includes("file-system")) return 12;
  if (haystack.includes("slack")) return 20;
  if (haystack.includes("jira") || haystack.includes("atlassian")) return 18;
  if (haystack.includes("postgres") || haystack.includes("sqlite") || haystack.includes("database")) return 10;
  return 8;
}

function contextWeight(estimatedToolCount: number): ContextWeightEntry["weight"] {
  if (estimatedToolCount >= 60) return "extreme";
  if (estimatedToolCount >= 20) return "heavy";
  if (estimatedToolCount >= 10) return "medium";
  return "light";
}

function contextWeightReasons(server: NormalizedServer, estimatedToolCount: number): string[] {
  const haystack = `${server.name} ${server.packageName || ""}`.toLowerCase();
  const reasons = [`estimated ${estimatedToolCount} loaded tools`];
  if (haystack.includes("github")) reasons.push("GitHub servers often expose many repo, issue, PR, and workflow tools");
  if (haystack.includes("playwright") || haystack.includes("browser")) reasons.push("browser automation servers expose broad interaction tools");
  if (haystack.includes("slack")) reasons.push("chat/workspace servers can expose many channel and message tools");
  if (haystack.includes("jira") || haystack.includes("atlassian")) reasons.push("project-management servers can expose many issue and search tools");
  return reasons;
}

function hasBroadFilesystemAccess(server: NormalizedServer, options: ScanOptions): boolean {
  const haystack = `${server.name} ${server.packageName || ""}`.toLowerCase();
  if (!haystack.includes("filesystem") && !haystack.includes("file-system")) return false;
  const homeDir = options.homeDir || process.env.HOME || "";
  return server.args.some((arg) => arg === "/" || arg === "~" || arg === homeDir || arg === path.parse(homeDir).root);
}

function looksLikeLocalFileArgument(arg: string): boolean {
  if (arg.startsWith("-") || arg.startsWith("http://") || arg.startsWith("https://")) return false;
  return (
    arg.startsWith("/") ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    /\.(js|mjs|cjs|ts|py|rb|go|jar|json|yaml|yml)$/i.test(arg)
  );
}

function looksLikeEnvReference(value: string): boolean {
  return /^\$\{?[A-Z_][A-Z0-9_]*}?$/.test(value);
}

function envReferenceName(value: string): string | undefined {
  const match = value.match(/^\$\{?([A-Z_][A-Z0-9_]*)}?$/);
  return match?.[1];
}

function looksLikePlaceholder(value: string): boolean {
  return /^(your_|changeme|replace_me|example|placeholder)/i.test(value);
}

function hashish(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}
