import os from "node:os";
import type { Diagnostic, ScanReport } from "./types.js";
import { redactString, redactValue } from "./redact.js";

export type ReportFormat = "json" | "markdown" | "html";

export function sanitizeReport(report: ScanReport, homeDir = os.homedir()): ScanReport {
  const sanitized = structuredClone(report);
  sanitized.workspace = redactString(sanitized.workspace, homeDir);
  sanitized.configs = sanitized.configs.map((config) => ({
    ...config,
    filePath: redactString(config.filePath, homeDir),
    rawText: undefined,
    content: undefined,
    parseError: config.parseError ? redactString(config.parseError, homeDir) : undefined
  }));
  sanitized.servers = sanitized.servers.map((server) => ({
    ...server,
    sourceFile: redactString(server.sourceFile, homeDir),
    args: server.args.map((arg) => redactString(arg, homeDir)),
    env: redactValue(server.env, homeDir) as Record<string, string>,
    raw: redactValue(server.raw, homeDir) as Record<string, unknown>
  }));
  sanitized.diagnostics = sanitized.diagnostics.map((diagnostic) => sanitizeDiagnostic(diagnostic, homeDir));
  sanitized.patchPlans = sanitized.patchPlans.map((plan) => ({
    ...plan,
    operations: plan.operations.map((operation) => ({
      ...operation,
      filePath: redactString(operation.filePath, homeDir),
      value: redactValue(operation.value, homeDir),
      matchValue: redactValue(operation.matchValue, homeDir)
    }))
  }));
  return redactValue(sanitized, homeDir) as ScanReport;
}

export function renderReport(report: ScanReport, format: ReportFormat, homeDir = os.homedir()): string {
  const safe = sanitizeReport(report, homeDir);
  if (format === "json") return `${JSON.stringify(safe, null, 2)}\n`;
  if (format === "html") return renderHtml(safe);
  return renderMarkdown(safe);
}

export function renderMarkdown(report: ScanReport): string {
  const diagnostics = report.diagnostics;
  return [
    `# dr-mcp Report`,
    ``,
    `Generated: ${report.generatedAt}`,
    `Workspace: \`${report.workspace}\``,
    `Registry checks: ${report.registryEnabled ? "enabled" : "disabled"}`,
    ``,
    `## Score`,
    ``,
    `- Overall: **${report.score.overall}/100**`,
    `- Reliability: ${report.score.reliability}/100`,
    `- Security: ${report.score.security}/100`,
    `- Context Hygiene: ${report.score.contextHygiene}/100`,
    `- Maintainability: ${report.score.maintainability}/100`,
    ``,
    `## Summary`,
    ``,
    `- Config files found: ${report.summary.configFiles}`,
    `- Parsed config files: ${report.summary.parsedConfigFiles}`,
    `- Enabled servers: ${report.summary.enabledServerCount}/${report.summary.serverCount}`,
    `- Duplicate server entries: ${report.summary.duplicateServerCount}`,
    `- Estimated loaded tools: ${report.summary.estimatedToolCount}`,
    `- Context risk: **${report.summary.contextRisk}**`,
    `- Context-heavy servers: ${report.summary.heavyServerCount}`,
    `- Usage tracking: ${report.usage.trackingEnabled ? `enabled (${report.usage.trackedServerCount} tracked)` : "disabled"}`,
    `- Long-lived install review candidates: ${report.usage.reviewCandidateCount}`,
    `- Package upgrades pending: ${upgradeFindings(report).length}`,
    `- Major upgrades pending: ${upgradeFindings(report).filter((finding) => finding.updateType === "major").length}`,
    ``,
    `## Package Upgrades`,
    ``,
    ...formatUpgrades(report),
    ``,
    `## Context Weight`,
    ``,
    ...formatContextWeights(report),
    ``,
    `## Install History`,
    ``,
    ...formatUsageSignals(report),
    ``,
    `## Findings`,
    ``,
    ...(diagnostics.length === 0
      ? [`No findings. Your MCP setup looks clean.`]
      : diagnostics.map((diagnostic) => formatDiagnostic(diagnostic))),
    ``,
    `## Patch Plans`,
    ``,
    ...(report.patchPlans.length === 0
      ? [`No safe patch plans are available for this scan.`]
      : report.patchPlans.map(
          (plan) =>
            `### ${plan.title}\n\n- ID: \`${plan.id}\`\n- Risk: ${plan.risk}\n- Operations: ${plan.operations.length}\n- ${plan.description}`
        )),
    ``
  ].join("\n");
}

function formatUpgrades(report: ScanReport): string[] {
  if (!report.registryEnabled) return [`Run with \`--registry\` to check npm latest versions and major upgrade gaps.`];
  const findings = upgradeFindings(report);
  if (findings.length === 0) return [`No stale MCP package pins found.`];
  return findings.map((finding) => {
    const label = finding.updateType === "major" ? "major" : finding.updateType || "unknown";
    return `- **${finding.packageName}**: ${finding.installedVersion} -> ${finding.latestVersion} (${label}).`;
  });
}

function upgradeFindings(report: ScanReport) {
  return report.registryFindings.filter(
    (finding) => finding.status === "stale" && finding.installedVersion && finding.latestVersion
  );
}

function formatContextWeights(report: ScanReport): string[] {
  if (report.contextWeights.length === 0) return [`No enabled MCP servers found.`];
  return report.contextWeights.slice(0, 10).map((entry) => {
    const packageText = entry.packageName ? ` (${entry.packageName})` : "";
    return `- **${entry.serverName}**${packageText}: ${entry.estimatedToolCount} estimated tools, ${entry.weight} context weight. ${entry.reasons.join("; ")}.`;
  });
}

function formatUsageSignals(report: ScanReport): string[] {
  if (!report.usage.trackingEnabled) {
    return [`Usage tracking is off. Run with \`--track-usage\` to build a local install-history ledger without changing MCP client configs.`];
  }
  if (report.usageSignals.length === 0) return [`No enabled MCP servers found to track.`];
  const candidates = report.usageSignals.filter((signal) => signal.status === "long-lived");
  const rows = candidates.length > 0 ? candidates : report.usageSignals.slice(0, 10);
  return rows.map((signal) => {
    const days = signal.daysInstalled === undefined ? "unknown age" : `${signal.daysInstalled} days`;
    return `- **${signal.serverName}**: ${signal.status}, ${signal.scanCount} tracked scan(s), ${days}. ${signal.message}.`;
  });
}

function renderHtml(report: ScanReport): string {
  const markdown = renderMarkdown(report);
  const body = escapeHtml(markdown)
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^\- (.*)$/gm, "<li>$1</li>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "\n");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>dr-mcp Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; line-height: 1.5; color: #151515; }
    code { background: #f2f2f2; padding: 2px 5px; border-radius: 4px; }
    h1, h2, h3 { line-height: 1.2; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
${body}
</body>
</html>
`;
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const parts = [
    `- **[${diagnostic.severity.toUpperCase()}] ${diagnostic.title}**`,
    `  ${diagnostic.message}`
  ];
  if (diagnostic.serverName) parts.push(`  Server: \`${diagnostic.serverName}\``);
  if (diagnostic.sourceFile) parts.push(`  Source: \`${diagnostic.sourceFile}\``);
  if (diagnostic.fixPlanId) parts.push(`  Patch plan: \`${diagnostic.fixPlanId}\``);
  return parts.join("\n");
}

function sanitizeDiagnostic(diagnostic: Diagnostic, homeDir: string): Diagnostic {
  return {
    ...diagnostic,
    sourceFile: diagnostic.sourceFile ? redactString(diagnostic.sourceFile, homeDir) : undefined,
    message: redactString(diagnostic.message, homeDir),
    evidence: diagnostic.evidence ? redactString(diagnostic.evidence, homeDir) : undefined
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
