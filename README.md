# MCP Doctor

Roast and repair your MCP setup.

MCP Doctor is a local-first CLI and MCP server that audits MCP configuration across the coding tools developers actually use, scores risk, explains problems, and creates reversible repair plans.

It is built for Claude Desktop, Claude Code (`cc`), OpenAI Codex CLI and Codex IDE, Cursor, Windsurf, GitHub Copilot in VS Code, GitHub Copilot CLI, VS Code and VS Code Insiders, Cline, Roo Code, Continue, Zed, and plain project `.mcp.json` files.

## Quick Start

```bash
npx @inferensys/mcp-doctor scan --workspace .
npx @inferensys/mcp-doctor scan --workspace . --registry --track-usage
npx @inferensys/mcp-doctor scan --json --registry
npx @inferensys/mcp-doctor report --format html --workspace . > mcp-doctor-report.html
npx @inferensys/mcp-doctor patch --plan remove-duplicate-servers --apply --workspace .
npx @inferensys/mcp-doctor server
```

By default reports are redacted and local-only. Add `--registry` to include live npm and official MCP Registry metadata checks.

## What It Checks

- Broken JSON, JSONC, YAML, and TOML config files
- Duplicate MCP server names across clients
- Missing launch commands, dead paths, and unsupported transports
- Unpinned `npx` package installs and `latest` usage
- Broad filesystem access
- Inline secrets and secret-like command arguments
- Broken environment variable references
- Excessive tool count and context hygiene risk
- Stale, missing, or mismatched package metadata when `--registry` is enabled
- Archived, abandoned, or quiet GitHub repositories when package metadata points to GitHub
- Context-heavy MCPs ranked by estimated loaded tool count
- Long-lived installed MCPs from the optional local usage ledger

## Supported Config Locations

| Tool | Configs scanned |
| --- | --- |
| Claude Desktop | `claude_desktop_config.json` |
| Claude Code / `cc` | `~/.claude.json`, `~/.claude/settings.json`, `.claude/settings.json` |
| OpenAI Codex | `~/.codex/config.toml`, `.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json`, `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json`, `.windsurf/mcp.json` |
| GitHub Copilot in VS Code | VS Code user settings, VS Code Insiders settings, `.vscode/mcp.json`, `.vscode/settings.json` |
| GitHub Copilot CLI | `~/.copilot/mcp-config.json`, `.copilot/mcp-config.json` |
| Cline | `~/.cline/data/settings/cline_mcp_settings.json`, `.cline/data/settings/cline_mcp_settings.json` |
| Roo Code | `.roo/mcp.json`, common Roo VS Code global storage paths |
| Continue | `~/.continue/config.yaml`, `.continue/config.yaml` |
| Zed | Zed user settings, `.zed/settings.json` |
| Generic MCP | `.mcp.json` |

## MCP Tools

Run MCP Doctor as a server:

```bash
npx @inferensys/mcp-doctor server
```

Tools exposed:

- `scan_mcp_setup`
- `explain_issue`
- `generate_patch_plan`
- `apply_patch_plan`
- `export_report`

## Install Snippets

### Codex

```bash
codex mcp add mcp-doctor -- npx -y @inferensys/mcp-doctor server
```

Equivalent `.codex/config.toml`:

```toml
[mcp_servers.mcp-doctor]
command = "npx"
args = ["-y", "@inferensys/mcp-doctor", "server"]
```

### Claude Code

```bash
claude mcp add mcp-doctor -- npx -y @inferensys/mcp-doctor server
```

### Claude Desktop, Cursor, Windsurf, Cline, Roo Code, VS Code, GitHub Copilot in VS Code

Add this server entry to the tool's MCP JSON config:

```json
{
  "mcpServers": {
    "mcp-doctor": {
      "command": "npx",
      "args": ["-y", "@inferensys/mcp-doctor", "server"]
    }
  }
}
```

VS Code and GitHub Copilot also accept the `servers` form:

```json
{
  "servers": {
    "mcp-doctor": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@inferensys/mcp-doctor", "server"]
    }
  }
}
```

### GitHub Copilot CLI

Use `/mcp add` in Copilot CLI, or add this to `~/.copilot/mcp-config.json`:

```json
{
  "servers": {
    "mcp-doctor": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@inferensys/mcp-doctor", "server"]
    }
  }
}
```

### Zed

```json
{
  "context_servers": {
    "mcp-doctor": {
      "command": "npx",
      "args": ["-y", "@inferensys/mcp-doctor", "server"]
    }
  }
}
```

### Continue

```yaml
mcpServers:
  mcp-doctor:
    command: npx
    args:
      - -y
      - @inferensys/mcp-doctor
      - server
```

## Safety Model

Scan never writes MCP client configs. Patch plans are explicit operations only, and applying a plan creates timestamped backups before changing a config file. Reports are redacted by default for secrets, tokens, emails, home paths, and private GitHub repo URLs.

Usage tracking is opt-in. `--track-usage` writes a local MCP Doctor ledger at `~/.mcp-doctor/usage-ledger.json` so reports can identify MCP servers that have stayed installed across multiple scans. MCP Doctor does not claim true per-tool usage unless a client exposes reliable usage data.

MCP Doctor does not auto-install, uninstall, upgrade packages, or do destructive cleanup in v1.

## Development

```bash
npm install
npm run check
node dist/cli.js scan --workspace tests/fixtures/mixed --json
```

## Registry

Registry name: `io.github.Inferensys/mcp-doctor`

Package: `@inferensys/mcp-doctor`
