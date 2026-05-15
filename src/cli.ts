#!/usr/bin/env node

import process from "node:process";
import { scanMcpSetup } from "./scanner.js";
import { applyPatchPlan } from "./patch.js";
import { renderReport, type ReportFormat } from "./report.js";
import { runMcpServer } from "./mcp-server.js";

interface CliArgs {
  command: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

async function main(): Promise<void> {
  let { command, flags, positionals } = parseArgs(process.argv.slice(2));
  ({ command, flags, positionals } = normalizeCommand(command, flags, positionals));
  if (booleanFlag(flags, "help") || command === "help") {
    printHelp();
    return;
  }
  if (!command) command = "scan";
  const workspace = stringFlag(flags.workspace) || process.cwd();
  const registry = booleanFlag(flags, "registry");
  const trackUsage = booleanFlag(flags, "track-usage");
  const usageLedgerPath = stringFlag(flags["usage-ledger"]);

  if (command === "scan") {
    const report = await scanMcpSetup({ workspace, registry, trackUsage, usageLedgerPath });
    const format: ReportFormat = booleanFlag(flags, "json") ? "json" : "markdown";
    process.stdout.write(renderReport(report, format));
    return;
  }

  if (command === "report") {
    const format = parseReportFormat(stringFlag(flags.format) || "markdown");
    const report = await scanMcpSetup({ workspace, registry, trackUsage, usageLedgerPath });
    process.stdout.write(renderReport(report, format));
    return;
  }

  if (command === "patch") {
    const requestedPlanId = stringFlag(flags.plan);
    if (!requestedPlanId) throw new Error("patch requires --plan <planId>");
    const planId = normalizePlanId(requestedPlanId);
    const report = await scanMcpSetup({
      workspace,
      registry: registry || planId === "upgrade-stale-packages" || planId === "remove-abandoned-servers",
      trackUsage,
      usageLedgerPath
    });
    const plan = report.patchPlans.find((item) => item.id === planId);
    if (!plan) {
      process.stdout.write(`No patch plan found for "${planId}". Run scan --registry to see available plans.\n`);
      process.exitCode = 1;
      return;
    }
    if (!booleanFlag(flags, "apply")) {
      process.stdout.write(renderReport({ ...report, patchPlans: [plan] }, "markdown"));
      process.stdout.write("\nDry run only. Re-run with --apply to create backups and write changes.\n");
      return;
    }
    const result = await applyPatchPlan(plan, report.configs);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "server") {
    await runMcpServer();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(args: string[]): CliArgs {
  const command = args[0]?.startsWith("--") ? "" : args[0] || "";
  const rest = command ? args.slice(1) : args;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const separatorIndex = arg.indexOf("=");
    const name = separatorIndex === -1 ? arg.slice(2) : arg.slice(2, separatorIndex);
    const inlineValue = separatorIndex === -1 ? undefined : arg.slice(separatorIndex + 1);
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i++;
    }
  }
  return { command, flags, positionals };
}

function normalizeCommand(
  command: string,
  flags: Record<string, string | boolean>,
  positionals: string[]
): CliArgs {
  if (!command) return { command, flags, positionals };
  if (command === "doctor") {
    const action = positionals[0] || "scan";
    const rest = positionals.slice(1);
    if (action === "scan" || action === "audit" || action === "cleanup" || action === "clean") {
      return { command: "scan", flags: withCleanupDefaults(flags), positionals: rest };
    }
    if (action === "report") {
      return { command: "report", flags: withCleanupDefaults(flags), positionals: rest };
    }
    if (action === "patch") {
      return { command: "patch", flags, positionals: rest };
    }
    return { command: action, flags, positionals: rest };
  }
  if (command === "cleanup" || command === "clean") {
    return { command: "scan", flags: withCleanupDefaults(flags), positionals };
  }
  if (command === "scan" && booleanFlag(flags, "deep")) {
    return { command, flags: withCleanupDefaults(flags), positionals };
  }
  return { command, flags, positionals };
}

function withCleanupDefaults(flags: Record<string, string | boolean>): Record<string, string | boolean> {
  const next = { ...flags };
  if (booleanFlag(next, "local")) {
    next["no-registry"] = true;
    next["no-track-usage"] = true;
  }
  if (next.registry === undefined && next["no-registry"] === undefined) next.registry = true;
  if (next["track-usage"] === undefined && next["no-track-usage"] === undefined) next["track-usage"] = true;
  return next;
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(flags: Record<string, string | boolean>, key: string): boolean {
  if (flags[`no-${key}`] !== undefined) return false;
  const value = flags[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return !["false", "0", "no", "off"].includes(value.toLowerCase());
  return false;
}

function parseReportFormat(value: string): ReportFormat {
  if (value === "json" || value === "markdown" || value === "html") return value;
  throw new Error(`Unsupported report format: ${value}`);
}

function printHelp(): void {
  process.stdout.write(`MCP Doctor - clean your MCPs

Usage:
  mcp-doctor [--json] [--workspace <path>]
  mcp-doctor cleanup [--json] [--workspace <path>] [--local]
  mcp-doctor doctor scan [--json] [--workspace <path>] [--local]
  mcp-doctor scan [--json] [--workspace <path>] [--registry] [--track-usage]
  mcp-doctor report [--format markdown|html|json] [--workspace <path>] [--registry] [--track-usage]
  mcp-doctor patch --plan <planId> [--apply] [--workspace <path>] [--track-usage]
  mcp-doctor server

Examples:
  npx @inferensys/mcp-doctor
  npx @inferensys/mcp-doctor cleanup
  npx @inferensys/mcp-doctor doctor scan
  npx @inferensys/mcp-doctor scan --json --registry
  npx @inferensys/mcp-doctor patch --plan upgrade-stale-packages
  npx @inferensys/mcp-doctor patch --plan remove-duplicate-servers --apply

Notes:
  Default scan is local-only and does not write a usage ledger.
  cleanup and doctor scan enable package/repo checks plus local install-history tracking.
  Add --local to cleanup or doctor scan to skip network checks and ledger writes.
`);
}

function normalizePlanId(planId: string): string {
  if (planId === "pin-npx-packages") return "upgrade-stale-packages";
  return planId;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
