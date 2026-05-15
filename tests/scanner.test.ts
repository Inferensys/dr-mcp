import { mkdtemp, cp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanMcpSetup, renderReport, applyPatchPlan } from "../src/index.js";
import { checkPackageRegistry } from "../src/registry.js";
import type { NormalizedServer } from "../src/types.js";

const fixture = path.resolve("tests/fixtures/mixed");
const codingToolsFixture = path.resolve("tests/fixtures/coding-tools");

describe("MCP Doctor scanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds common MCP configuration issues", async () => {
    const report = await scanMcpSetup({ workspace: fixture, includeGlobal: false });
    const ids = report.diagnostics.map((diagnostic) => diagnostic.id);
    expect(report.summary.serverCount).toBe(5);
    expect(ids.some((id) => id.startsWith("duplicate-server:github"))).toBe(true);
    expect(ids.some((id) => id.startsWith("inline-secret-env"))).toBe(true);
    expect(ids.some((id) => id.startsWith("broad-filesystem"))).toBe(true);
    expect(ids.some((id) => id.startsWith("missing-launch"))).toBe(true);
    expect(ids.some((id) => id.startsWith("unpinned-package"))).toBe(true);
    expect(ids.some((id) => id.startsWith("missing-path"))).toBe(true);
    expect(report.summary.contextRisk).toBe("high");
  });

  it("redacts secrets in exported JSON", async () => {
    const report = await scanMcpSetup({ workspace: fixture, includeGlobal: false });
    const json = renderReport(report, "json");
    expect(json).not.toContain("ghp_123456789012345678901234567890123456");
    expect(json).toContain("[REDACTED_SECRET]");
  });

  it("exports markdown and html reports", async () => {
    const report = await scanMcpSetup({ workspace: fixture, includeGlobal: false });
    expect(renderReport(report, "markdown")).toContain("# MCP Doctor Report");
    expect(renderReport(report, "html")).toContain("<!doctype html>");
  });

  it("scans Codex, Copilot CLI, Cline, Roo Code, Continue, and Zed configs", async () => {
    const report = await scanMcpSetup({ workspace: codingToolsFixture, includeGlobal: false });
    const targets = new Set(report.servers.map((server) => server.target));
    expect(targets.has("codex")).toBe(true);
    expect(targets.has("github-copilot")).toBe(true);
    expect(targets.has("cline")).toBe(true);
    expect(targets.has("roo-code")).toBe(true);
    expect(targets.has("continue")).toBe(true);
    expect(targets.has("zed")).toBe(true);
    expect(report.servers.find((server) => server.name === "copilot-search")?.packageVersion).toBe("latest");
    expect(report.servers.find((server) => server.name === "remote_docs")?.transport).toBe("http");
    expect(renderReport(report, "json")).not.toContain(process.env.HOME || "");
  });

  it("handles mocked registry results and creates package pin plans", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("server-filesystem")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ "dist-tags": { latest: "1.2.3" } })
        };
      })
    );
    const report = await scanMcpSetup({ workspace: fixture, includeGlobal: false, registry: true });
    expect(report.registryFindings.some((finding) => finding.status === "missing")).toBe(true);
    const pinPlan = report.patchPlans.find((plan) => plan.id === "pin-npx-packages");
    expect(pinPlan?.operations.length).toBeGreaterThan(0);
  });

  it("handles registry missing, stale, offline, malformed, and mismatch cases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("missing-package")) return { ok: false, status: 404, json: async () => ({}) };
        if (url.includes("offline-package")) throw new Error("network down");
        if (url.includes("malformed-package")) return { ok: true, status: 200, json: async () => ({}) };
        if (url.includes("registry.modelcontextprotocol.io")) {
          return { ok: true, status: 200, json: async () => ({ servers: [] }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "dist-tags": { latest: "2.0.0" },
            versions: { "2.0.0": { mcpName: "io.github.example/stale-package" } }
          })
        };
      })
    );
    const servers = ["missing-package", "offline-package", "malformed-package", "stale-package", "mismatch-package"].map(
      (packageName) =>
        ({
          id: packageName,
          name: packageName,
          target: "plain-mcp",
          sourceFile: "/tmp/.mcp.json",
          sourceLabel: "test",
          pointer: ["servers", packageName],
          raw: {},
          args: [packageName === "stale-package" ? `${packageName}@1.0.0` : `${packageName}@2.0.0`],
          env: {},
          command: "npx",
          packageName,
          packageVersion: packageName === "stale-package" ? "1.0.0" : "2.0.0"
        }) satisfies NormalizedServer
    );
    const findings = await checkPackageRegistry(servers);
    expect(findings.map((finding) => finding.status)).toEqual([
      "missing",
      "unknown",
      "unknown",
      "stale",
      "registry-mismatch"
    ]);
  });

  it("applies duplicate-removal patch plans with backups and idempotence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-doctor-"));
    await cp(fixture, dir, { recursive: true });
    const firstReport = await scanMcpSetup({ workspace: dir, includeGlobal: false });
    const plan = firstReport.patchPlans.find((item) => item.id === "remove-duplicate-servers");
    expect(plan).toBeDefined();
    const result = await applyPatchPlan(plan!, firstReport.configs);
    expect(result.applied).toBe(true);
    expect(result.backups.length).toBeGreaterThan(0);
    const settings = await readFile(path.join(dir, ".vscode", "settings.json"), "utf8");
    expect(settings).not.toContain("\"github\"");

    const secondReport = await scanMcpSetup({ workspace: dir, includeGlobal: false });
    expect(secondReport.diagnostics.some((diagnostic) => diagnostic.id.startsWith("duplicate-server:github"))).toBe(false);
    const secondPlan = secondReport.patchPlans.find((item) => item.id === "remove-duplicate-servers");
    expect(secondPlan).toBeUndefined();
  });
});
