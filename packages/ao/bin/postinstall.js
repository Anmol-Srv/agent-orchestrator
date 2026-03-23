#!/usr/bin/env node
/**
 * Postinstall script for @composio/ao (npm/yarn global installs).
 *
 * Fixes the DirectTerminal "posix_spawnp failed" error that occurs when
 * `ao start` is run after a global npm install.
 *
 * Root cause: node-pty ships a `spawn-helper` binary that it forks to create
 * PTYs. This binary is published to npm without the execute bit set. In the
 * monorepo, `scripts/rebuild-node-pty.js` fixes this via `node-gyp rebuild`
 * after `pnpm install` — but that script uses a pnpm-specific path and never
 * runs for global npm/yarn installs.
 *
 * Fix: locate spawn-helper using a walk-up node_modules search (same approach
 * as the preflight checkBuilt fix) and chmod it to 0o755.
 */

import { chmodSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// spawn-helper is a Unix concept — nothing to do on Windows
if (process.platform === "win32") process.exit(0);

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from startDir looking for node_modules/<segments>.
 * Handles both npm global installs (hoisted deps) and pnpm workspaces
 * (symlinked deps), mirroring Node's own module resolution algorithm.
 */
function findPackageUp(startDir, ...segments) {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, "node_modules", ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

const nodePtyDir = findPackageUp(__dirname, "node-pty");
if (!nodePtyDir) {
  // node-pty not found in any ancestor node_modules — skip silently
  process.exit(0);
}

const spawnHelper = resolve(
  nodePtyDir,
  "prebuilds",
  `${process.platform}-${process.arch}`,
  "spawn-helper",
);

if (!existsSync(spawnHelper)) {
  // No prebuilt for this platform (e.g. linux-arm64) — skip silently
  process.exit(0);
}

try {
  chmodSync(spawnHelper, 0o755);
  console.log("✓ node-pty spawn-helper permissions set");
} catch {
  // Non-critical — don't fail the install over a chmod
  console.warn("⚠️  Could not set spawn-helper permissions (non-critical)");
  console.warn(`   Try manually: chmod +x ${spawnHelper}`);
}
