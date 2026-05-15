export type {
  ConfigFile,
  ConfigTarget,
  ContextWeightEntry,
  Diagnostic,
  DiagnosticSeverity,
  NormalizedServer,
  PatchOperation,
  PatchPlan,
  PatchResult,
  RegistryFinding,
  RepositoryActivity,
  ScanOptions,
  ScanReport,
  ScoreCategory,
  ScoreSummary,
  UsageSignal,
  UsageSummary
} from "./types.js";
export { scanMcpSetup } from "./scanner.js";
export { applyPatchPlan, generatePatchPlans } from "./patch.js";
export { renderMarkdown, renderReport, sanitizeReport, type ReportFormat } from "./report.js";
export { discoverConfigFiles } from "./discover.js";
export { normalizeServers } from "./normalize.js";
