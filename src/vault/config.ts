/**
 * config.ts — Backend configuration for psst vaults.
 *
 * Each vault directory may contain a `config.json` file that selects which
 * storage backend to use. If absent, the default (sqlite) is used.
 *
 * File format:
 * {
 *   "backend": "sqlite" | "aws",
 *   "aws": {
 *     "region": "us-east-1",   // optional; falls back to AWS_REGION / AWS_DEFAULT_REGION
 *     "prefix": "psst/",       // optional; default "psst/"
 *     "profile": "my-profile"  // optional; default credential chain
 *   }
 * }
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type BackendType = "sqlite" | "aws";

export interface AwsBackendConfig {
  /** AWS region. If not set, falls back to AWS_REGION, then AWS_DEFAULT_REGION. */
  region?: string;
  /** Prefix applied to every secret name in AWS. Default "psst/". */
  prefix?: string;
  /** Named AWS profile. If not set, uses the default credential provider chain. */
  profile?: string;
}

export interface VaultConfig {
  backend: BackendType;
  aws?: AwsBackendConfig;
}

const CONFIG_FILE = "config.json";
const DEFAULT_CONFIG: VaultConfig = { backend: "sqlite" };
const DEFAULT_AWS_PREFIX = "psst/";

/**
 * Load the vault config from a vault directory.
 * Missing file -> default (sqlite) config.
 * Malformed file -> throws.
 */
export function loadConfig(vaultPath: string): VaultConfig {
  const configPath = join(vaultPath, CONFIG_FILE);
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err: any) {
    throw new Error(`Failed to read vault config at ${configPath}: ${err.message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Invalid JSON in vault config ${configPath}: ${err.message}`);
  }

  return normalizeConfig(parsed, configPath);
}

/**
 * Persist a vault config to disk.
 */
export function saveConfig(vaultPath: string, config: VaultConfig): void {
  const configPath = join(vaultPath, CONFIG_FILE);
  const normalized = normalizeConfig(config, configPath);
  writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

/**
 * Resolve the effective AWS region, honoring config -> AWS_REGION -> AWS_DEFAULT_REGION.
 */
export function resolveAwsRegion(config: AwsBackendConfig | undefined): string | undefined {
  return (
    config?.region ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    undefined
  );
}

/**
 * Resolve the effective AWS secret name prefix.
 */
export function resolveAwsPrefix(config: AwsBackendConfig | undefined): string {
  const prefix = config?.prefix ?? DEFAULT_AWS_PREFIX;
  // Normalize: ensure trailing slash if non-empty
  if (prefix === "") return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function normalizeConfig(raw: unknown, configPath: string): VaultConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Vault config ${configPath} must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  const backend = obj.backend ?? "sqlite";

  if (backend !== "sqlite" && backend !== "aws") {
    throw new Error(
      `Unknown backend "${String(backend)}" in ${configPath}. Expected "sqlite" or "aws".`,
    );
  }

  const result: VaultConfig = { backend };

  if (backend === "aws") {
    const awsRaw = (obj.aws ?? {}) as Record<string, unknown>;
    const aws: AwsBackendConfig = {};

    if (awsRaw.region !== undefined) {
      if (typeof awsRaw.region !== "string") {
        throw new Error(`aws.region must be a string in ${configPath}`);
      }
      aws.region = awsRaw.region;
    }
    if (awsRaw.prefix !== undefined) {
      if (typeof awsRaw.prefix !== "string") {
        throw new Error(`aws.prefix must be a string in ${configPath}`);
      }
      aws.prefix = awsRaw.prefix;
    }
    if (awsRaw.profile !== undefined) {
      if (typeof awsRaw.profile !== "string") {
        throw new Error(`aws.profile must be a string in ${configPath}`);
      }
      aws.profile = awsRaw.profile;
    }

    result.aws = aws;
  }

  return result;
}
