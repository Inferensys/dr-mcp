export type ScoreCategory =
  | "reliability"
  | "security"
  | "contextHygiene"
  | "maintainability";

export type DiagnosticSeverity = "info" | "low" | "medium" | "high";

export type ConfigFormat = "json" | "jsonc" | "yaml" | "toml";

export type ConfigTarget =
  | "claude-desktop"
  | "claude-code"
  | "codex"
  | "cursor"
  | "vscode"
  | "github-copilot"
  | "windsurf"
  | "cline"
  | "roo-code"
  | "continue"
  | "zed"
  | "plain-mcp";

export interface ScanOptions {
  workspace: string;
  homeDir?: string;
  registry?: boolean;
  includeGlobal?: boolean;
  redact?: boolean;
  trackUsage?: boolean;
  usageLedgerPath?: string;
}

export interface ConfigFile {
  id: string;
  target: ConfigTarget;
  label: string;
  filePath: string;
  format: ConfigFormat;
  exists: boolean;
  parseError?: string;
  content?: unknown;
  rawText?: string;
}

export interface NormalizedServer {
  id: string;
  name: string;
  target: ConfigTarget;
  sourceFile: string;
  sourceLabel: string;
  pointer: string[];
  raw: Record<string, unknown>;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  transport?: string;
  disabled?: boolean;
  packageName?: string;
  packageVersion?: string;
}

export interface RegistryFinding {
  serverId: string;
  packageName: string;
  installedVersion?: string;
  latestVersion?: string;
  updateType?: "major" | "minor" | "patch" | "unknown";
  mcpName?: string;
  repository?: RepositoryActivity;
  status: "ok" | "stale" | "missing" | "unknown" | "registry-mismatch";
  message: string;
}

export interface RepositoryActivity {
  url: string;
  host: "github" | "unknown";
  owner?: string;
  repo?: string;
  archived?: boolean;
  disabled?: boolean;
  stars?: number;
  openIssues?: number;
  lastPushedAt?: string;
  daysSincePush?: number;
  status: "active" | "quiet" | "abandoned" | "archived" | "unknown";
  message: string;
}

export interface Diagnostic {
  id: string;
  category: ScoreCategory;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  target?: ConfigTarget;
  sourceFile?: string;
  serverId?: string;
  serverName?: string;
  evidence?: string;
  fixPlanId?: string;
}

export interface ScoreSummary {
  overall: number;
  reliability: number;
  security: number;
  contextHygiene: number;
  maintainability: number;
}

export interface PatchOperation {
  id: string;
  filePath: string;
  type: "set" | "remove" | "replace-array-value";
  pointer: string[];
  value?: unknown;
  matchValue?: unknown;
  description: string;
}

export interface PatchPlan {
  id: string;
  title: string;
  description: string;
  risk: "low" | "medium";
  diagnostics: string[];
  operations: PatchOperation[];
}

export interface PatchResult {
  planId: string;
  applied: boolean;
  backups: string[];
  changedFiles: string[];
  diffs: Record<string, string>;
  skipped: string[];
}

export interface ContextWeightEntry {
  serverId: string;
  serverName: string;
  target: ConfigTarget;
  sourceFile: string;
  packageName?: string;
  estimatedToolCount: number;
  weight: "light" | "medium" | "heavy" | "extreme";
  reasons: string[];
}

export interface UsageSignal {
  serverId: string;
  serverName: string;
  target: ConfigTarget;
  sourceFile: string;
  packageName?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  scanCount: number;
  daysInstalled?: number;
  status: "not-tracked" | "new" | "tracked" | "long-lived";
  message: string;
}

export interface UsageSummary {
  trackingEnabled: boolean;
  ledgerPath?: string;
  trackedServerCount: number;
  reviewCandidateCount: number;
}

export interface ScanReport {
  generatedAt: string;
  workspace: string;
  registryEnabled: boolean;
  score: ScoreSummary;
  summary: {
    configFiles: number;
    parsedConfigFiles: number;
    serverCount: number;
    enabledServerCount: number;
    duplicateServerCount: number;
    estimatedToolCount: number;
    contextRisk: "low" | "medium" | "high";
    heavyServerCount: number;
  };
  contextWeights: ContextWeightEntry[];
  usage: UsageSummary;
  usageSignals: UsageSignal[];
  configs: ConfigFile[];
  servers: NormalizedServer[];
  registryFindings: RegistryFinding[];
  diagnostics: Diagnostic[];
  patchPlans: PatchPlan[];
}
