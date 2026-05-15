import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigFile, Diagnostic, NormalizedServer, PatchOperation, PatchPlan, PatchResult, RegistryFinding } from "./types.js";
import { createBackup, writeTextWithDirs } from "./fs-utils.js";
import { parseConfigText, serializeConfig } from "./parse.js";
import { getAtPointer, removeAtPointer, setAtPointer } from "./normalize.js";

export function generatePatchPlans(
  diagnostics: Diagnostic[],
  servers: NormalizedServer[],
  registryFindings: RegistryFinding[]
): PatchPlan[] {
  const plans: PatchPlan[] = [];
  const duplicateOps = removeOpsForDiagnostics("remove-duplicate-servers", diagnostics, servers);
  if (duplicateOps.length > 0) {
    plans.push({
      id: "remove-duplicate-servers",
      title: "Remove duplicate MCP server entries",
      description: "Removes duplicate server definitions, keeping the first enabled definition for each server name.",
      risk: "medium",
      diagnostics: diagnostics.filter((item) => item.fixPlanId === "remove-duplicate-servers").map((item) => item.id),
      operations: duplicateOps
    });
  }

  const deadOps = removeOpsForDiagnostics("remove-dead-servers", diagnostics, servers);
  if (deadOps.length > 0) {
    plans.push({
      id: "remove-dead-servers",
      title: "Remove entries that cannot launch",
      description: "Removes server definitions that have no launch command/URL or reference packages that are missing from npm.",
      risk: "medium",
      diagnostics: diagnostics.filter((item) => item.fixPlanId === "remove-dead-servers").map((item) => item.id),
      operations: deadOps
    });
  }

  const pinOps = pinPackageOps(servers, registryFindings);
  if (pinOps.length > 0) {
    plans.push({
      id: "pin-npx-packages",
      title: "Pin npx package versions",
      description: "Replaces unpinned or stale npx package references with the latest resolved npm version.",
      risk: "low",
      diagnostics: diagnostics.filter((item) => item.fixPlanId === "pin-npx-packages").map((item) => item.id),
      operations: pinOps
    });
  }
  return plans;
}

export async function applyPatchPlan(plan: PatchPlan, configs: ConfigFile[]): Promise<PatchResult> {
  const configsByPath = new Map(configs.filter((config) => config.exists).map((config) => [config.filePath, config]));
  const operationsByPath = groupOperations(plan.operations);
  const result: PatchResult = {
    planId: plan.id,
    applied: false,
    backups: [],
    changedFiles: [],
    diffs: {},
    skipped: []
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const [filePath, operations] of operationsByPath.entries()) {
    const config = configsByPath.get(filePath);
    if (!config) {
      result.skipped.push(`${filePath}: config was not discovered`);
      continue;
    }
    if (config.parseError) {
      result.skipped.push(`${filePath}: config has parse errors`);
      continue;
    }
    const rawText = await readFile(filePath, "utf8");
    const document = parseConfigText(rawText, config.format);
    const nextDocument = structuredClone(document);
    let changed = false;
    for (const operation of operations) {
      const didChange = applyOperation(nextDocument, operation);
      if (didChange) changed = true;
      else result.skipped.push(`${operation.id}: no matching value to change`);
    }
    if (!changed) continue;
    const nextText = serializeConfig(nextDocument, config.format);
    if (nextText === rawText) continue;
    const backupPath = await createBackup(filePath, `mcp-doctor-${stamp}`);
    await writeTextWithDirs(filePath, nextText);
    result.backups.push(backupPath);
    result.changedFiles.push(filePath);
    result.diffs[filePath] = createSimpleDiff(rawText, nextText, filePath);
    result.applied = true;
  }
  return result;
}

function removeOpsForDiagnostics(planId: string, diagnostics: Diagnostic[], servers: NormalizedServer[]): PatchOperation[] {
  const byId = new Map(servers.map((server) => [server.id, server]));
  return diagnostics
    .filter((diagnostic) => diagnostic.fixPlanId === planId && diagnostic.serverId)
    .flatMap((diagnostic) => {
      const server = byId.get(diagnostic.serverId as string);
      if (!server) return [];
      return [
        {
          id: `${planId}:${server.id}`,
          filePath: server.sourceFile,
          type: "remove",
          pointer: server.pointer,
          description: `Remove "${server.name}" from ${path.basename(server.sourceFile)}`
        } satisfies PatchOperation
      ];
    });
}

function pinPackageOps(servers: NormalizedServer[], registryFindings: RegistryFinding[]): PatchOperation[] {
  const latestByPackage = new Map<string, string>();
  for (const finding of registryFindings) {
    if (finding.latestVersion) latestByPackage.set(finding.packageName, finding.latestVersion);
  }
  const operations: PatchOperation[] = [];
  for (const server of servers) {
    if (!server.packageName) continue;
    const latest = latestByPackage.get(server.packageName);
    if (!latest) continue;
    if (server.packageVersion === latest) continue;
    const currentRef = packageRef(server.packageName, server.packageVersion);
    const nextRef = packageRef(server.packageName, latest);
    operations.push({
      id: `pin-npx:${server.id}`,
      filePath: server.sourceFile,
      type: "replace-array-value",
      pointer: [...server.pointer, "args"],
      matchValue: currentRef,
      value: nextRef,
      description: `Pin "${server.packageName}" to ${latest}`
    });
  }
  return operations;
}

function packageRef(name: string, version?: string): string {
  if (!version) return name;
  return name.startsWith("@") ? `${name}@${version}` : `${name}@${version}`;
}

function groupOperations(operations: PatchOperation[]): Map<string, PatchOperation[]> {
  const grouped = new Map<string, PatchOperation[]>();
  for (const operation of operations) {
    grouped.set(operation.filePath, [...(grouped.get(operation.filePath) || []), operation]);
  }
  return grouped;
}

function applyOperation(document: unknown, operation: PatchOperation): boolean {
  if (operation.type === "remove") return removeAtPointer(document, operation.pointer);
  if (operation.type === "set") {
    const current = getAtPointer(document, operation.pointer);
    if (JSON.stringify(current) === JSON.stringify(operation.value)) return false;
    return setAtPointer(document, operation.pointer, operation.value);
  }
  if (operation.type === "replace-array-value") {
    const value = getAtPointer(document, operation.pointer);
    if (!Array.isArray(value)) return false;
    const index = value.findIndex((item) => item === operation.matchValue);
    if (index === -1) {
      if (value.includes(operation.value)) return false;
      return false;
    }
    if (value[index] === operation.value) return false;
    value[index] = operation.value;
    return true;
  }
  return false;
}

function createSimpleDiff(before: string, after: string, filePath: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = [`--- ${filePath}`, `+++ ${filePath}`];
  for (let i = 0; i < max; i++) {
    const left = beforeLines[i];
    const right = afterLines[i];
    if (left === right) continue;
    if (left !== undefined) lines.push(`-${left}`);
    if (right !== undefined) lines.push(`+${right}`);
  }
  return `${lines.join("\n")}\n`;
}
