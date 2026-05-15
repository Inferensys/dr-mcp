import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanMcpSetup } from "./scanner.js";
import { applyPatchPlan } from "./patch.js";
import { renderReport } from "./report.js";
import type { ScanOptions, ScanReport } from "./types.js";

const workspaceSchema = {
  workspace: z.string().optional().describe("Workspace path to scan. Defaults to the server process current directory."),
  registry: z.boolean().optional().describe("Enable live npm registry metadata checks."),
  trackUsage: z.boolean().optional().describe("Persist local scan history to identify long-lived MCP installs."),
  usageLedgerPath: z.string().optional().describe("Optional path for the local usage ledger.")
};

const doctorWorkflowSchema = {
  workspace: z.string().optional().describe("Workspace path to scan. Defaults to the server process current directory."),
  localOnly: z.boolean().optional().describe("Skip network checks and do not write the local usage ledger."),
  registry: z.boolean().optional().describe("Override live npm/package checks. Defaults to true unless localOnly is true."),
  trackUsage: z.boolean().optional().describe("Override local install-history tracking. Defaults to true unless localOnly is true."),
  usageLedgerPath: z.string().optional().describe("Optional path for the local usage ledger.")
};

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "mcp-doctor",
    version: "0.3.0"
  });

  server.tool(
    "doctor_scan",
    "One-step MCP cleanup scan for agent sessions. Checks context weight, stale packages, abandoned repos, duplicates, and safe patch plans.",
    doctorWorkflowSchema,
    async (params) => {
      const report = await scanMcpSetup(doctorScanOptions(params));
      return jsonContent({
        summary: summarizeForAgent(report),
        report
      });
    }
  );

  server.tool(
    "doctor_cleanup",
    "Scan and return the highest-value MCP cleanup candidates. Does not apply patches.",
    doctorWorkflowSchema,
    async (params) => {
      const report = await scanMcpSetup(doctorScanOptions(params));
      return jsonContent({
        cleanup: summarizeForAgent(report),
        nextStep: "Preview one patch plan with generate_patch_plan. Apply only after the user explicitly confirms.",
        report
      });
    }
  );

  server.tool(
    "scan_mcp_setup",
    "Scan local MCP configuration files and return a redacted diagnostic report.",
    workspaceSchema,
    async (params) => {
      const report = await scanMcpSetup({
        workspace: params.workspace,
        registry: params.registry,
        trackUsage: params.trackUsage,
        usageLedgerPath: params.usageLedgerPath
      });
      return jsonContent(report);
    }
  );

  server.tool(
    "explain_issue",
    "Explain a diagnostic from the current MCP setup scan.",
    {
      ...workspaceSchema,
      diagnosticId: z.string().describe("Diagnostic ID from scan_mcp_setup.")
    },
    async (params) => {
      const report = await scanMcpSetup({
        workspace: params.workspace,
        registry: params.registry,
        trackUsage: params.trackUsage,
        usageLedgerPath: params.usageLedgerPath
      });
      const diagnostic = report.diagnostics.find((item) => item.id === params.diagnosticId);
      if (!diagnostic) return jsonContent({ error: true, message: `Diagnostic not found: ${params.diagnosticId}` });
      return jsonContent({
        diagnostic,
        explanation: `${diagnostic.title}: ${diagnostic.message}`,
        patchPlan: diagnostic.fixPlanId
          ? report.patchPlans.find((plan) => plan.id === diagnostic.fixPlanId)
          : undefined
      });
    }
  );

  server.tool(
    "generate_patch_plan",
    "Generate a reversible patch plan for a scan finding.",
    {
      ...workspaceSchema,
      planId: z.string().describe("Patch plan ID, such as remove-duplicate-servers or upgrade-stale-packages.")
    },
    async (params) => {
      const report = await scanMcpSetup({
        workspace: params.workspace,
        registry: true,
        trackUsage: params.trackUsage,
        usageLedgerPath: params.usageLedgerPath
      });
      const plan = report.patchPlans.find((item) => item.id === normalizePlanId(params.planId));
      if (!plan) return jsonContent({ error: true, message: `Patch plan not found: ${params.planId}` });
      return jsonContent(plan);
    }
  );

  server.tool(
    "apply_patch_plan",
    "Apply a patch plan after explicit confirmation. Creates backups before writing.",
    {
      ...workspaceSchema,
      planId: z.string().describe("Patch plan ID to apply."),
      confirm: z.boolean().describe("Must be true to apply config changes.")
    },
    async (params) => {
      if (!params.confirm) {
        return jsonContent({ error: true, message: "Set confirm=true to apply a patch plan." });
      }
      const report = await scanMcpSetup({
        workspace: params.workspace,
        registry: true,
        trackUsage: params.trackUsage,
        usageLedgerPath: params.usageLedgerPath
      });
      const plan = report.patchPlans.find((item) => item.id === normalizePlanId(params.planId));
      if (!plan) return jsonContent({ error: true, message: `Patch plan not found: ${params.planId}` });
      return jsonContent(await applyPatchPlan(plan, report.configs));
    }
  );

  server.tool(
    "export_report",
    "Export a redacted MCP Doctor report as Markdown, HTML, or JSON.",
    {
      ...workspaceSchema,
      format: z.enum(["markdown", "html", "json"]).optional().describe("Report format. Defaults to markdown.")
    },
    async (params) => {
      const report = await scanMcpSetup({
        workspace: params.workspace,
        registry: params.registry,
        trackUsage: params.trackUsage,
        usageLedgerPath: params.usageLedgerPath
      });
      return {
        content: [{ type: "text" as const, text: renderReport(report, params.format || "markdown") }]
      };
    }
  );

  server.prompt(
    "doctor",
    "Run MCP Doctor from an agent session. Use action=scan for a report or action=cleanup for removal/upgrade candidates.",
    {
      action: z.enum(["scan", "cleanup"]).optional().describe("Workflow to run. Defaults to scan."),
      workspace: z.string().optional().describe("Workspace path to scan. Defaults to the current session workspace."),
      localOnly: z.string().optional().describe("Set to true to skip network checks and usage-ledger writes.")
    },
    (params) => promptContent(buildDoctorPrompt(params.action || "scan", params.workspace, params.localOnly === "true"))
  );

  server.prompt(
    "doctor_scan",
    "Scan this workspace's MCP setup and return a short cleanup report.",
    () => promptContent(buildDoctorPrompt("scan"))
  );

  server.prompt(
    "doctor_cleanup",
    "Find MCPs to remove, upgrade, or keep out of this project. Does not apply patches.",
    () => promptContent(buildDoctorPrompt("cleanup"))
  );

  await server.connect(new StdioServerTransport());
}

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function normalizePlanId(planId: string): string {
  if (planId === "pin-npx-packages") return "upgrade-stale-packages";
  return planId;
}

function doctorScanOptions(params: {
  workspace?: string;
  localOnly?: boolean;
  registry?: boolean;
  trackUsage?: boolean;
  usageLedgerPath?: string;
}): Partial<ScanOptions> {
  const localOnly = params.localOnly === true;
  return {
    workspace: params.workspace,
    registry: localOnly ? false : params.registry ?? true,
    trackUsage: localOnly ? false : params.trackUsage ?? true,
    usageLedgerPath: params.usageLedgerPath
  };
}

function summarizeForAgent(report: ScanReport) {
  return {
    score: report.score,
    totals: report.summary,
    topContextServers: report.contextWeights.slice(0, 6).map((item) => ({
      serverName: item.serverName,
      estimatedToolCount: item.estimatedToolCount,
      weight: item.weight,
      reasons: item.reasons
    })),
    cleanupFindings: report.diagnostics.slice(0, 12).map((diagnostic) => ({
      id: diagnostic.id,
      severity: diagnostic.severity,
      title: diagnostic.title,
      serverName: diagnostic.serverName,
      fixPlanId: diagnostic.fixPlanId
    })),
    patchPlans: report.patchPlans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      operationCount: plan.operations.length
    })),
    reminder: "Scans do not edit configs. Patch plans require apply_patch_plan with confirm=true."
  };
}

function buildDoctorPrompt(action: "scan" | "cleanup", workspace?: string, localOnly = false): string {
  const toolName = action === "cleanup" ? "doctor_cleanup" : "doctor_scan";
  const args = [
    workspace ? `workspace: ${JSON.stringify(workspace)}` : undefined,
    localOnly ? "localOnly: true" : undefined
  ].filter(Boolean);
  return [
    `Run MCP Doctor ${action} for this workspace.`,
    `Call the ${toolName} tool${args.length > 0 ? ` with ${args.join(", ")}` : ""}.`,
    "Give me the score, top cleanup findings, context-heavy MCPs, unmaintained or abandoned MCPs, unused/long-lived installs, major upgrades, and patch plan IDs.",
    "Keep the answer short and practical. Do not apply a patch plan unless I explicitly ask you to apply a named plan."
  ].join("\n");
}

function promptContent(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text }
      }
    ]
  };
}
