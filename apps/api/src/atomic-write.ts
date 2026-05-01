import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Atomically write data to a file using write-to-temp + rename.
 *
 * This prevents data corruption if the process crashes mid-write:
 * - Writes to a temporary file in the same directory
 * - Renames temp → target (atomic on POSIX, near-atomic on Windows)
 * - If the process dies during write, the temp file is orphaned but
 *   the original file remains intact
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tempPath = join(dir, `.tmp-${randomUUID()}.json`);
  try {
    writeFileSync(tempPath, data, "utf-8");
    renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure (best-effort)
    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(tempPath);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}
