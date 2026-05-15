#!/usr/bin/env node

import process from "node:process";
import { scanMcpSetup } from "./scanner.js";
import { applyPatchPlan } from "./patch.js";
import { renderReport, type ReportFormat } from "./report.js";
import { runMcpServer } from "./mcp-server.js";

interface CliArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || flags.help) {
    printHelp();
    return;
  }
  const workspace = stringFlag(flags.workspace) || process.cwd();
  const registry = Boolean(flags.registry);
  const trackUsage = Boolean(flags["track-usage"]);
  const usageLedgerPath = stringFlag(flags["usage-ledger"]);

  if (command === "scan") {
    const report = await scanMcpSetup({ workspace, registry, trackUsage, usageLedgerPath });
    const format: ReportFormat = flags.json ? "json" : "markdown";
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
    if (!flags.apply) {
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
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i++;
    }
  }
  return { command, flags };
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseReportFormat(value: string): ReportFormat {
  if (value === "json" || value === "markdown" || value === "html") return value;
  throw new Error(`Unsupported report format: ${value}`);
}

function printHelp(): void {
  process.stdout.write(`MCP Doctor - roast and repair your MCP setup

Usage:
  mcp-doctor scan [--json] [--workspace <path>] [--registry] [--track-usage]
  mcp-doctor report [--format markdown|html|json] [--workspace <path>] [--registry] [--track-usage]
  mcp-doctor patch --plan <planId> [--apply] [--workspace <path>] [--track-usage]
  mcp-doctor server

Examples:
  npx @inferensys/mcp-doctor scan --workspace .
  npx @inferensys/mcp-doctor scan --json --registry
  npx @inferensys/mcp-doctor scan --track-usage
  npx @inferensys/mcp-doctor patch --plan upgrade-stale-packages
  npx @inferensys/mcp-doctor patch --plan remove-duplicate-servers --apply
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
