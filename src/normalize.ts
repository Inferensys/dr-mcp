import path from "node:path";
import type { ConfigFile, NormalizedServer } from "./types.js";

export function normalizeServers(configs: ConfigFile[]): NormalizedServer[] {
  const servers: NormalizedServer[] = [];
  for (const config of configs) {
    if (!config.exists || config.parseError || !isRecord(config.content)) continue;
    const roots = serverRoots(config.content);
    for (const root of roots) {
      const value = getAtPointer(config.content, root.pointer);
      if (!isRecord(value)) continue;
      for (const [name, rawServer] of Object.entries(value)) {
        if (!isRecord(rawServer)) continue;
        const pointer = [...root.pointer, name];
        const parsedLaunch = normalizeLaunch(rawServer.command, rawServer.args);
        const args = parsedLaunch.args;
        const command = parsedLaunch.command;
        const url = stringValue(rawServer.url) || stringValue(rawServer.serverUrl);
        const transport = stringValue(rawServer.transport) || inferTransport(command, url);
        const packageRef = inferPackageRef(command, args);
        servers.push({
          id: `${config.id}:${pointer.join("/")}`,
          name,
          target: config.target,
          sourceFile: config.filePath,
          sourceLabel: config.label,
          pointer,
          raw: rawServer,
          command,
          args,
          env: normalizeEnv(rawServer.env),
          url,
          transport,
          disabled: Boolean(rawServer.disabled) || rawServer.enabled === false,
          packageName: packageRef?.name,
          packageVersion: packageRef?.version
        });
      }
    }
  }
  return servers;
}

export function serverRoots(content: unknown): Array<{ pointer: string[]; label: string }> {
  const roots: Array<{ pointer: string[]; label: string }> = [];
  if (isRecord(content)) {
    if (isRecord(content.mcpServers)) roots.push({ pointer: ["mcpServers"], label: "mcpServers" });
    if (isRecord(content.servers)) roots.push({ pointer: ["servers"], label: "servers" });
    if (isRecord(content.mcp) && isRecord(content.mcp.servers)) {
      roots.push({ pointer: ["mcp", "servers"], label: "mcp.servers" });
    }
    if (isRecord(content["mcp.servers"])) roots.push({ pointer: ["mcp.servers"], label: "mcp.servers" });
    if (isRecord(content.mcp_servers)) roots.push({ pointer: ["mcp_servers"], label: "mcp_servers" });
    if (isRecord(content.context_servers)) roots.push({ pointer: ["context_servers"], label: "context_servers" });
  }
  return roots;
}

export function getAtPointer(value: unknown, pointer: string[]): unknown {
  let current = value;
  for (const part of pointer) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setAtPointer(value: unknown, pointer: string[], nextValue: unknown): boolean {
  const parent = getAtPointer(value, pointer.slice(0, -1));
  const key = pointer[pointer.length - 1];
  if (!key || (!isRecord(parent) && !Array.isArray(parent))) return false;
  (parent as Record<string, unknown>)[key] = nextValue;
  return true;
}

export function removeAtPointer(value: unknown, pointer: string[]): boolean {
  const parent = getAtPointer(value, pointer.slice(0, -1));
  const key = pointer[pointer.length - 1];
  if (!key || (!isRecord(parent) && !Array.isArray(parent))) return false;
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) return false;
    parent.splice(index, 1);
    return true;
  }
  if (!(key in parent)) return false;
  delete (parent as Record<string, unknown>)[key];
  return true;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeLaunch(commandValue: unknown, argsValue: unknown): { command?: string; args: string[] } {
  const args = normalizeArgs(argsValue);
  const command = stringValue(commandValue);
  if (!command || args.length > 0 || !/\s/.test(command.trim())) return { command, args };
  const parts = splitCommandLine(command);
  if (parts.length === 0) return { command, args };
  return { command: parts[0], args: parts.slice(1) };
}

function splitCommandLine(value: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts;
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") env[key] = item;
  }
  return env;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function inferTransport(command?: string, url?: string): string | undefined {
  if (url) return "http";
  if (command) return "stdio";
  return undefined;
}

function inferPackageRef(command: string | undefined, args: string[]): { name: string; version?: string } | undefined {
  const executable = path.basename(command || "");
  if (!["npx", "pnpm", "yarn", "bunx", "uvx"].includes(executable)) return undefined;
  const ignored = new Set(["-y", "--yes", "--package", "--from", "dlx", "exec"]);
  const ref = args.find((arg) => !arg.startsWith("-") && !ignored.has(arg));
  if (!ref) return undefined;
  return splitPackageRef(ref);
}

function splitPackageRef(ref: string): { name: string; version?: string } | undefined {
  if (ref.startsWith("@")) {
    const secondAt = ref.indexOf("@", 1);
    if (secondAt === -1) return { name: ref };
    return { name: ref.slice(0, secondAt), version: ref.slice(secondAt + 1) };
  }
  const at = ref.indexOf("@");
  if (at === -1) return { name: ref };
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}
