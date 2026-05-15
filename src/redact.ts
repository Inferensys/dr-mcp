const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|pwd|api[_-]?key|auth|bearer|client[_-]?secret|private[_-]?key|access[_-]?key)/i;
const SECRET_VALUE_PATTERN =
  /(sk-[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|[A-Za-z0-9_-]{32,})/;
const SECRET_VALUE_REDACT_PATTERN =
  /(sk-[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|[A-Za-z0-9_-]{32,})/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRIVATE_REPO_PATTERN = /git@github\.com:([^/\s]+)\/([^.\s]+)(?:\.git)?/g;

export function redactString(value: string, homeDir?: string): string {
  let redacted = value;
  if (homeDir) {
    redacted = redacted.split(homeDir).join("~");
  }
  redacted = redacted.replace(SECRET_VALUE_REDACT_PATTERN, "[REDACTED_SECRET]");
  redacted = redacted.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
  redacted = redacted.replace(PRIVATE_REPO_PATTERN, "git@github.com:[REDACTED_ORG]/[REDACTED_REPO]");
  return redacted;
}

export function redactValue(value: unknown, homeDir?: string, keyHint = ""): unknown {
  if (typeof value === "string") {
    if (SECRET_KEY_PATTERN.test(keyHint)) return "[REDACTED_SECRET]";
    return redactString(value, homeDir);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, homeDir, `${keyHint}.${index}`));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = redactValue(item, homeDir, key);
    }
    return next;
  }
  return value;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function containsSecret(value: string): boolean {
  return SECRET_VALUE_PATTERN.test(value) || /Bearer\s+/i.test(value);
}
