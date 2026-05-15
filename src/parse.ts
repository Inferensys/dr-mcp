import YAML from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { ConfigFormat } from "./types.js";

export function detectFormat(filePath: string): ConfigFormat {
  if (filePath.endsWith(".toml")) return "toml";
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "yaml";
  if (filePath.endsWith(".jsonc") || filePath.endsWith("settings.json")) return "jsonc";
  return "json";
}

export function parseConfigText(text: string, format: ConfigFormat): unknown {
  if (format === "toml") return parseToml(text);
  if (format === "yaml") return YAML.parse(text);
  return JSON.parse(stripJsonComments(text));
}

export function serializeConfig(value: unknown, format: ConfigFormat): string {
  if (format === "toml") return stringifyToml(value as Record<string, unknown>);
  if (format === "yaml") return YAML.stringify(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += char;
  }
  return out;
}
