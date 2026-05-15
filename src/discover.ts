import os from "node:os";
import path from "node:path";
import type { ConfigFile, ConfigTarget, ScanOptions } from "./types.js";
import { detectFormat, parseConfigText } from "./parse.js";
import { pathExists, readTextIfExists } from "./fs-utils.js";

interface Candidate {
  target: ConfigTarget;
  label: string;
  filePath: string;
}

export async function discoverConfigFiles(options: ScanOptions): Promise<ConfigFile[]> {
  const workspace = path.resolve(options.workspace);
  const homeDir = options.homeDir || os.homedir();
  const includeGlobal = options.includeGlobal !== false;
  const candidates = dedupeCandidates([
    ...workspaceCandidates(workspace),
    ...(includeGlobal ? globalCandidates(homeDir) : [])
  ]);

  const configs: ConfigFile[] = [];
  for (const candidate of candidates) {
    const exists = await pathExists(candidate.filePath);
    const format = detectFormat(candidate.filePath);
    const config: ConfigFile = {
      id: `${candidate.target}:${candidate.filePath}`,
      target: candidate.target,
      label: candidate.label,
      filePath: candidate.filePath,
      format,
      exists
    };
    if (exists) {
      const rawText = await readTextIfExists(candidate.filePath);
      config.rawText = rawText;
      try {
        config.content = rawText === undefined ? undefined : parseConfigText(rawText, format);
      } catch (error) {
        config.parseError = error instanceof Error ? error.message : String(error);
      }
    }
    configs.push(config);
  }
  return configs;
}

function workspaceCandidates(workspace: string): Candidate[] {
  return [
    {
      target: "plain-mcp",
      label: "Project .mcp.json",
      filePath: path.join(workspace, ".mcp.json")
    },
    {
      target: "cursor",
      label: "Cursor project MCP",
      filePath: path.join(workspace, ".cursor", "mcp.json")
    },
    {
      target: "vscode",
      label: "VS Code project MCP",
      filePath: path.join(workspace, ".vscode", "mcp.json")
    },
    {
      target: "vscode",
      label: "VS Code project settings",
      filePath: path.join(workspace, ".vscode", "settings.json")
    },
    {
      target: "windsurf",
      label: "Windsurf project MCP",
      filePath: path.join(workspace, ".windsurf", "mcp.json")
    },
    {
      target: "claude-code",
      label: "Claude Code project settings",
      filePath: path.join(workspace, ".claude", "settings.json")
    },
    {
      target: "codex",
      label: "Codex project config",
      filePath: path.join(workspace, ".codex", "config.toml")
    },
    {
      target: "github-copilot",
      label: "GitHub Copilot CLI project MCP",
      filePath: path.join(workspace, ".copilot", "mcp-config.json")
    },
    {
      target: "cline",
      label: "Cline project MCP",
      filePath: path.join(workspace, ".cline", "data", "settings", "cline_mcp_settings.json")
    },
    {
      target: "roo-code",
      label: "Roo Code project MCP",
      filePath: path.join(workspace, ".roo", "mcp.json")
    },
    {
      target: "continue",
      label: "Continue project config",
      filePath: path.join(workspace, ".continue", "config.yaml")
    },
    {
      target: "zed",
      label: "Zed project settings",
      filePath: path.join(workspace, ".zed", "settings.json")
    }
  ];
}

function globalCandidates(homeDir: string): Candidate[] {
  const candidates: Candidate[] = [
    {
      target: "claude-code",
      label: "Claude Code global config",
      filePath: path.join(homeDir, ".claude.json")
    },
    {
      target: "claude-code",
      label: "Claude Code global settings",
      filePath: path.join(homeDir, ".claude", "settings.json")
    },
    {
      target: "codex",
      label: "Codex global config",
      filePath: path.join(homeDir, ".codex", "config.toml")
    },
    {
      target: "github-copilot",
      label: "GitHub Copilot CLI global MCP",
      filePath: path.join(homeDir, ".copilot", "mcp-config.json")
    },
    {
      target: "cursor",
      label: "Cursor global MCP",
      filePath: path.join(homeDir, ".cursor", "mcp.json")
    },
    {
      target: "windsurf",
      label: "Windsurf global MCP",
      filePath: path.join(homeDir, ".codeium", "windsurf", "mcp_config.json")
    },
    {
      target: "cline",
      label: "Cline global MCP",
      filePath: path.join(homeDir, ".cline", "data", "settings", "cline_mcp_settings.json")
    },
    {
      target: "roo-code",
      label: "Roo Code global MCP",
      filePath: path.join(homeDir, ".roo", "mcp.json")
    },
    {
      target: "continue",
      label: "Continue global config",
      filePath: path.join(homeDir, ".continue", "config.yaml")
    }
  ];
  if (process.platform === "darwin") {
    candidates.push(
      {
        target: "claude-desktop",
        label: "Claude Desktop",
        filePath: path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      },
      {
        target: "vscode",
        label: "VS Code user settings",
        filePath: path.join(homeDir, "Library", "Application Support", "Code", "User", "settings.json")
      },
      {
        target: "vscode",
        label: "VS Code Insiders user settings",
        filePath: path.join(homeDir, "Library", "Application Support", "Code - Insiders", "User", "settings.json")
      },
      {
        target: "zed",
        label: "Zed user settings",
        filePath: path.join(homeDir, "Library", "Application Support", "Zed", "settings.json")
      },
      {
        target: "roo-code",
        label: "Roo Code VS Code global MCP",
        filePath: path.join(
          homeDir,
          "Library",
          "Application Support",
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "mcp_settings.json"
        )
      }
    );
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    candidates.push(
      {
        target: "claude-desktop",
        label: "Claude Desktop",
        filePath: path.join(appData, "Claude", "claude_desktop_config.json")
      },
      {
        target: "vscode",
        label: "VS Code user settings",
        filePath: path.join(appData, "Code", "User", "settings.json")
      },
      {
        target: "vscode",
        label: "VS Code Insiders user settings",
        filePath: path.join(appData, "Code - Insiders", "User", "settings.json")
      },
      {
        target: "zed",
        label: "Zed user settings",
        filePath: path.join(appData, "Zed", "settings.json")
      },
      {
        target: "roo-code",
        label: "Roo Code VS Code global MCP",
        filePath: path.join(appData, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json")
      }
    );
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
    candidates.push(
      {
        target: "claude-desktop",
        label: "Claude Desktop",
        filePath: path.join(configHome, "Claude", "claude_desktop_config.json")
      },
      {
        target: "vscode",
        label: "VS Code user settings",
        filePath: path.join(configHome, "Code", "User", "settings.json")
      },
      {
        target: "vscode",
        label: "VS Code Insiders user settings",
        filePath: path.join(configHome, "Code - Insiders", "User", "settings.json")
      },
      {
        target: "zed",
        label: "Zed user settings",
        filePath: path.join(configHome, "zed", "settings.json")
      },
      {
        target: "roo-code",
        label: "Roo Code VS Code global MCP",
        filePath: path.join(configHome, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json")
      }
    );
  }
  return candidates;
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.target}:${candidate.filePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
