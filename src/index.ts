export type {
  ConfigFile,
  ConfigTarget,
  Diagnostic,
  DiagnosticSeverity,
  NormalizedServer,
  PatchOperation,
  PatchPlan,
  PatchResult,
  RegistryFinding,
  ScanOptions,
  ScanReport,
  ScoreCategory,
  ScoreSummary
} from "./types.js";
export { scanMcpSetup } from "./scanner.js";
export { applyPatchPlan, generatePatchPlans } from "./patch.js";
export { renderMarkdown, renderReport, sanitizeReport, type ReportFormat } from "./report.js";
export { discoverConfigFiles } from "./discover.js";
export { normalizeServers } from "./normalize.js";
