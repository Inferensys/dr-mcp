import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanMcpSetup } from "./scanner.js";
import { applyPatchPlan } from "./patch.js";
import { renderReport } from "./report.js";

const workspaceSchema = {
  workspace: z.string().optional().describe("Workspace path to scan. Defaults to the server process current directory."),
  registry: z.boolean().optional().describe("Enable live npm registry metadata checks."),
  trackUsage: z.boolean().optional().describe("Persist local scan history to identify long-lived MCP installs."),
  usageLedgerPath: z.string().optional().describe("Optional path for the local usage ledger.")
};

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "mcp-doctor",
    version: "0.2.0"
  });

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
      planId: z.string().describe("Patch plan ID, such as remove-duplicate-servers or pin-npx-packages.")
    },
    async (params) => {
      const report = await scanMcpSetup({
        workspace: params.workspace,
        registry: true,
        trackUsage: params.trackUsage,
        usageLedgerPath: params.usageLedgerPath
      });
      const plan = report.patchPlans.find((item) => item.id === params.planId);
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
      const plan = report.patchPlans.find((item) => item.id === params.planId);
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

  await server.connect(new StdioServerTransport());
}

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}
