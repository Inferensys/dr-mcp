import os from "node:os";
import path from "node:path";
import type { NormalizedServer, ScanOptions, UsageSignal, UsageSummary } from "./types.js";
import { pathExists, readTextIfExists, writeTextWithDirs } from "./fs-utils.js";

interface UsageLedger {
  version: 1;
  entries: Record<string, UsageEntry>;
}

interface UsageEntry {
  serverId: string;
  serverName: string;
  target: string;
  sourceFile: string;
  packageName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
}

export async function analyzeUsageSignals(
  servers: NormalizedServer[],
  options: ScanOptions
): Promise<{ summary: UsageSummary; signals: UsageSignal[] }> {
  const ledgerPath = usageLedgerPath(options);
  const trackingEnabled = Boolean(options.trackUsage);
  const ledger = await readUsageLedger(ledgerPath);
  const now = new Date().toISOString();
  const enabledServers = servers.filter((server) => !server.disabled);
  const signals: UsageSignal[] = [];

  for (const server of enabledServers) {
    const key = usageKey(server);
    let entry = ledger.entries[key];
    if (trackingEnabled) {
      entry = {
        serverId: server.id,
        serverName: server.name,
        target: server.target,
        sourceFile: server.sourceFile,
        packageName: server.packageName,
        firstSeenAt: entry?.firstSeenAt || now,
        lastSeenAt: now,
        scanCount: (entry?.scanCount || 0) + 1
      };
      ledger.entries[key] = entry;
    }
    signals.push(signalFor(server, entry, trackingEnabled));
  }

  if (trackingEnabled) {
    await writeTextWithDirs(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  const reviewCandidateCount = signals.filter((signal) => signal.status === "long-lived").length;
  return {
    summary: {
      trackingEnabled,
      ledgerPath,
      trackedServerCount: signals.filter((signal) => signal.status !== "not-tracked").length,
      reviewCandidateCount
    },
    signals
  };
}

function signalFor(server: NormalizedServer, entry: UsageEntry | undefined, trackingEnabled: boolean): UsageSignal {
  if (!entry) {
    return {
      serverId: server.id,
      serverName: server.name,
      target: server.target,
      sourceFile: server.sourceFile,
      packageName: server.packageName,
      scanCount: 0,
      status: "not-tracked",
      message: trackingEnabled
        ? "First scan with usage tracking enabled"
        : "Usage tracking is disabled; run with --track-usage to build local install history"
    };
  }

  const daysInstalled = daysBetween(entry.firstSeenAt, new Date().toISOString());
  const status: UsageSignal["status"] =
    daysInstalled >= 60 && entry.scanCount >= 3 ? "long-lived" : entry.scanCount <= 1 ? "new" : "tracked";
  return {
    serverId: server.id,
    serverName: server.name,
    target: server.target,
    sourceFile: server.sourceFile,
    packageName: server.packageName,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
    scanCount: entry.scanCount,
    daysInstalled,
    status,
    message:
      status === "long-lived"
        ? `Installed across ${entry.scanCount} tracked scans for ${daysInstalled} days; review whether you still use it`
        : `Seen in ${entry.scanCount} tracked scan(s)`
  };
}

function usageLedgerPath(options: ScanOptions): string {
  if (options.usageLedgerPath) return path.resolve(options.usageLedgerPath);
  const homeDir = options.homeDir || os.homedir();
  return path.join(homeDir, ".mcp-doctor", "usage-ledger.json");
}

async function readUsageLedger(filePath: string): Promise<UsageLedger> {
  if (!(await pathExists(filePath))) return { version: 1, entries: {} };
  try {
    const text = await readTextIfExists(filePath);
    const parsed = text ? (JSON.parse(text) as Partial<UsageLedger>) : undefined;
    if (parsed?.version !== 1 || !parsed.entries) return { version: 1, entries: {} };
    return { version: 1, entries: parsed.entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

function usageKey(server: NormalizedServer): string {
  return [server.target, server.name, server.packageName || "", server.sourceFile, server.pointer.join("/")].join("|");
}

function daysBetween(start: string, end: string): number {
  const left = Date.parse(start);
  const right = Date.parse(end);
  if (Number.isNaN(left) || Number.isNaN(right)) return 0;
  return Math.max(0, Math.floor((right - left) / 86_400_000));
}
