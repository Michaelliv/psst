/**
 * native-env.ts — reads env vars via /proc/self/environ.
 *
 * Bun initialises process.env from envp[] very early in its startup
 * sequence. Sandbox supervisors (e.g. nono in ptrace/supervised mode)
 * may inject credentials into the process environment after exec, which
 * means they appear in the kernel's live view at /proc/self/environ but
 * are absent from process.env. Reading /proc/self/environ at call-time
 * captures the post-injection state, making those vars visible.
 *
 * Linux-only — on other platforms getenvNative always returns null.
 */

import { readFileSync } from "node:fs";

let _env: Map<string, string> | null | undefined = undefined;

function loadProcEnv(): Map<string, string> | null {
  if (process.platform !== "linux") return null;
  try {
    const raw = readFileSync("/proc/self/environ", "utf-8");
    const map = new Map<string, string>();
    for (const entry of raw.split("\0")) {
      const eq = entry.indexOf("=");
      if (eq !== -1) map.set(entry.slice(0, eq), entry.slice(eq + 1));
    }
    if (map.get("PSST_DEBUG") === "1" || process.env.PSST_DEBUG === "1") {
      process.stderr.write(
        `[psst debug] native-env: /proc/self/environ has ${map.size} entries,` +
          ` PSST_PASSWORD=${map.has("PSST_PASSWORD") ? "present" : "absent"}\n`,
      );
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Return the value of an environment variable from /proc/self/environ,
 * or null if unset or the file is unreadable.
 */
export function getenvNative(name: string): string | null {
  if (_env === undefined) _env = loadProcEnv();
  return _env?.get(name) ?? null;
}
