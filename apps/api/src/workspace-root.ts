import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function looksLikeWorkspaceRoot(dir: string): boolean {
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    const parsed = JSON.parse(readFileSync(pkg, "utf-8")) as { name?: string; workspaces?: unknown };
    return parsed.name === "tfc-rum-calculator-tool" || Array.isArray(parsed.workspaces);
  } catch {
    return false;
  }
}

export function getWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (looksLikeWorkspaceRoot(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir);
    }
    current = parent;
  }
}
