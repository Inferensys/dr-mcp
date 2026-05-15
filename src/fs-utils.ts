import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isExecutableOnPath(command: string, envPath = process.env.PATH || ""): Promise<boolean> {
  if (!command || command.includes("/") || command.includes("\\")) {
    return pathExists(command);
  }
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of envPath.split(path.delimiter)) {
    for (const ext of extensions) {
      if (await pathExists(path.join(dir, `${command}${ext}`))) return true;
    }
  }
  return false;
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  if (!(await pathExists(filePath))) return undefined;
  return readFile(filePath, "utf8");
}

export async function writeTextWithDirs(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

export async function createBackup(filePath: string, suffix: string): Promise<string> {
  const backupPath = `${filePath}.${suffix}.bak`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
