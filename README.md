# dr-mcp

Clean your MCPs.

Audit, clean, and slim down the MCP setup your coding agent loads every day.

If you use Claude Code, Codex, Cursor, Windsurf, Copilot, or VS Code across different projects, your MCP configs collect junk fast: old demo servers, duplicate GitHub tools, broad filesystem access, packages nobody maintains, and giant tool lists your agent has to sort through before it can write code.

dr-mcp scans that mess and shows what to remove.

```bash
npx @inferensys/dr-mcp
```

That starts a local scan in the current project. It does not delete anything. You get a cleanup report, a ranked list of context-heavy MCPs, and reversible patch plans you can apply after review.

For the full cleanup scan with package/repo checks and local install-history tracking:

```bash
npx @inferensys/dr-mcp cleanup
```

Inside Claude Code, Codex, Cursor, Windsurf, GitHub Copilot, or any MCP client that exposes server prompts/tools, use `dr_mcp_scan` or `dr_mcp_cleanup`. If your client maps MCP prompts into slash commands, use `/dr-mcp scan`.

## What It Helps You Fix

- **Reclaim context.** See which MCPs add the biggest tool lists to your agent's prompt.
- **Cut unwanted tool calls.** Remove old servers your agent keeps considering even when the project does not need them.
- **Ditch abandoned MCPs.** With `--registry`, check npm metadata and GitHub activity for archived or stale projects.
- **See major upgrades.** Find MCP packages pinned far behind npm latest and review upgrade plans.
- **Find leftovers.** Turn on `--track-usage` and build a local ledger of MCPs that keep showing up across scans.
- **Remove duplicates.** Spot the same MCP registered in Claude, Cursor, VS Code, Codex, Windsurf, or project files.
- **Fix risky configs.** Flag broad filesystem access, inline secrets, secret-looking args, missing commands, dead paths, and broken env refs.
- **Stop floating installs.** Catch `npx` packages using `latest` or no version.

## Commands

```bash
# Local audit in the current project
npx @inferensys/dr-mcp

# Deeper cleanup report with package/repo checks and local install history
npx @inferensys/dr-mcp cleanup

# Full scan alias for agent workflows
npx @inferensys/dr-mcp scan --deep

# Local-only cleanup flow with no network checks or usage ledger writes
npx @inferensys/dr-mcp cleanup --local

# JSON for scripts or CI
npx @inferensys/dr-mcp scan --workspace . --json --registry

# Shareable cleanup report
npx @inferensys/dr-mcp report --workspace . --format html > dr-mcp-report.html

# Preview a repair plan
npx @inferensys/dr-mcp patch --workspace . --plan remove-duplicate-servers
npx @inferensys/dr-mcp patch --workspace . --plan upgrade-stale-packages

# Apply a reviewed repair plan with backups
npx @inferensys/dr-mcp patch --workspace . --plan remove-duplicate-servers --apply

# Run as an MCP server
npx @inferensys/dr-mcp server
```

## Report Sections

- **Score:** reliability, security, context hygiene, maintainability.
- **Package upgrades:** MCP package pins behind npm latest, including major upgrades.
- **Context weight:** MCPs ranked by estimated tool load.
- **Install history:** long-lived servers from the local usage ledger.
- **Findings:** concrete issues with source config paths.
- **Patch plans:** safe edits such as removing duplicates, dead entries, abandoned servers, or context-heavy servers.

## Supported Tools

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
| Roo Code | `.roo/mcp.json`, common Roo Code VS Code global storage paths |
| Continue | `~/.continue/config.yaml`, `.continue/config.yaml` |
| Zed | Zed user settings, `.zed/settings.json` |
| Generic MCP | `.mcp.json` |

## Add dr-mcp To Your Agent

Once added, start from the shortest in-session action:

```text
dr_mcp_scan
```

For cleanup candidates, upgrades, abandoned servers, and long-lived installs:

```text
dr_mcp_cleanup
```

Clients that expose MCP prompts as slash commands may show these as `dr_mcp_scan`, `dr_mcp_cleanup`, or a prompt such as `/dr-mcp scan`.

### Codex

```bash
codex mcp add dr-mcp -- npx -y @inferensys/dr-mcp server
```

### Claude Code

```bash
claude mcp add dr-mcp -- npx -y @inferensys/dr-mcp server
```

### JSON config clients

Use this for Claude Desktop, Cursor, Windsurf, Cline, Roo Code, VS Code, and GitHub Copilot in VS Code:

```json
{
  "mcpServers": {
    "dr-mcp": {
      "command": "npx",
      "args": ["-y", "@inferensys/dr-mcp", "server"]
    }
  }
}
```

VS Code and GitHub Copilot may use `servers`:

```json
{
  "servers": {
    "dr-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@inferensys/dr-mcp", "server"]
    }
  }
}
```

### Zed

```json
{
  "context_servers": {
    "dr-mcp": {
      "command": "npx",
      "args": ["-y", "@inferensys/dr-mcp", "server"]
    }
  }
}
```

### Continue

```yaml
mcpServers:
  dr-mcp:
    command: npx
    args:
      - -y
      - @inferensys/dr-mcp
      - server
```

## MCP Tools

When running as a server, dr-mcp exposes:

- `dr_mcp_scan`
- `dr_mcp_cleanup`
- `scan_mcp_setup`
- `explain_issue`
- `generate_patch_plan`
- `apply_patch_plan`
- `export_report`

## MCP Prompts

- `dr_mcp` with `action=scan` or `action=cleanup`
- `dr_mcp_scan`
- `dr_mcp_cleanup`

## Safety

Scans never edit MCP client configs.

Patch plans create timestamped backups before writing. Reports redact secrets, tokens, emails, home paths, and private GitHub repo URLs.

Usage tracking is opt-in. `--track-usage` writes a local ledger at `~/.dr-mcp/usage-ledger.json`. It tracks what remains installed across scans; it does not claim true per-tool usage unless a client exposes that data.

dr-mcp does not auto-install, uninstall, upgrade packages, or run destructive cleanup.

## Development

```bash
npm install
npm run check
node dist/cli.js scan --workspace tests/fixtures/mixed --json
```

Registry name: `io.github.Inferensys/dr-mcp`

Package: `@inferensys/dr-mcp`
