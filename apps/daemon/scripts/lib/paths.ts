import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from `startDir` until a directory containing `pnpm-workspace.yaml`
 * is found. Returns the workspace root path.
 *
 * Throws if the workspace root cannot be found within 10 levels.
 */
export function getWorkspaceRoot(startDir: string): string {
  let current = startDir;
  const maxDepth = 10;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `Could not find workspace root (pnpm-workspace.yaml) walking up from ${startDir}`,
  );
}
