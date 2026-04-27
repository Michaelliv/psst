/**
 * aws-backend.ts — AWS Secrets Manager storage backend.
 *
 * Design decisions:
 *
 *   Naming:
 *     Each psst secret maps to one AWS secret, named `<prefix><NAME>`.
 *     Default prefix is "psst/" so a secret called TELEGRAM_BOT_TOKEN
 *     lives at "psst/TELEGRAM_BOT_TOKEN" in AWS. The prefix is stripped
 *     when listing.
 *
 *   Payload:
 *     The SecretString is a JSON envelope:
 *       { "value": "<raw secret>", "tags": ["t1", "t2"] }
 *     Tags are duplicated in the AWS resource Tags (Key=psst:tag, Value=<tag>)
 *     so AWS-side filtering via ListSecrets works too, but the JSON copy
 *     keeps listSecrets() to one API call per page rather than per secret.
 *
 *   Resource tagging:
 *     Every AWS secret managed by psst has Key=psst:managed, Value=true.
 *     Tags from the vault are stored as Key=psst:tag, Value=<tag> (one per tag).
 *     This lets us filter out unrelated secrets in the account when listing.
 *
 *   History:
 *     AWS Secrets Manager has native versioning — every PutSecretValue
 *     creates a new version and labels the previous one AWSPREVIOUS.
 *     We list versions via ListSecretVersionIds and map them to psst's
 *     monotonically-increasing version numbers (oldest = 1).
 *     CreatedDate on each version is the archived_at timestamp.
 *
 *   Rollback:
 *     Read the target version's value, then PutSecretValue — that creates
 *     a new version with the old payload, which matches psst's "rollback
 *     is reversible" contract.
 *
 *   Encryption:
 *     AWS handles encryption at rest (KMS). No client-side key management.
 *     unlock() is a no-op; the AWS SDK uses the default credential chain
 *     (IAM role on EC2, AWS_PROFILE, ~/.aws/credentials, etc).
 */

// We dynamically import the AWS SDK so users without AWS configured never
// pay the cold-start cost and so Bun's `--compile` doesn't drag it in.
// Type-only imports are erased by tsc at build time, so they're safe even
// when @aws-sdk/client-secrets-manager isn't installed.
import type {
  BatchGetSecretValueCommandOutput,
  DescribeSecretCommandOutput,
  GetSecretValueCommandOutput,
  ListSecretsCommandOutput,
  ListSecretVersionIdsCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import { errorMessage, isAwsErrorNamed } from "../utils/errors.js";
import type {
  SecretHistoryRecord,
  SecretMetaRecord,
  VaultBackend,
} from "./backend.js";
import type { AwsBackendConfig } from "./config.js";
import { resolveAwsPrefix, resolveAwsRegion } from "./config.js";

type AwsSdk = typeof import("@aws-sdk/client-secrets-manager");
type SecretsManagerClient = InstanceType<AwsSdk["SecretsManagerClient"]>;

const MANAGED_TAG_KEY = "psst:managed";
const MANAGED_TAG_VALUE = "true";
const USER_TAG_KEY_PREFIX = "psst:tag:"; // e.g., "psst:tag:prod" -> true

interface SecretEnvelope {
  value: string;
  tags: string[];
}

export class AwsBackend implements VaultBackend {
  readonly type = "aws";

  private sdk: AwsSdk | null = null;
  private client: SecretsManagerClient | null = null;
  private readonly prefix: string;
  private readonly region: string | undefined;
  private readonly profile: string | undefined;

  constructor(config: AwsBackendConfig | undefined) {
    this.prefix = resolveAwsPrefix(config);
    this.region = resolveAwsRegion(config);
    this.profile = config?.profile;
  }

  /**
   * Lazily construct the AWS SDK client. Throws a clear error if the
   * SDK isn't installed (it's a peer dependency, not bundled).
   */
  private async getClient(): Promise<{
    sdk: AwsSdk;
    client: SecretsManagerClient;
  }> {
    if (this.client && this.sdk) return { sdk: this.sdk, client: this.client };

    try {
      this.sdk = (await import("@aws-sdk/client-secrets-manager")) as AwsSdk;
    } catch (err) {
      throw new Error(
        `AWS backend requires @aws-sdk/client-secrets-manager. ` +
          `Install it: npm install @aws-sdk/client-secrets-manager. (${errorMessage(err)})`,
      );
    }

    const clientConfig: Record<string, unknown> = {};
    if (this.region) clientConfig.region = this.region;

    if (this.profile) {
      // Load profile credentials via @aws-sdk/credential-providers. If the
      // package isn't installed we fail loudly rather than mutate process.env
      // (which would leak into subprocesses spawned by psst run/exec).
      let credsMod: typeof import("@aws-sdk/credential-providers");
      try {
        credsMod = await import("@aws-sdk/credential-providers");
      } catch (err) {
        throw new Error(
          `AWS --aws-profile requires @aws-sdk/credential-providers. ` +
            `Install it: npm install @aws-sdk/credential-providers. (${errorMessage(err)})`,
        );
      }
      clientConfig.credentials = credsMod.fromNodeProviderChain({
        profile: this.profile,
      });
    }

    this.client = new this.sdk.SecretsManagerClient(clientConfig);
    return { sdk: this.sdk, client: this.client };
  }

  private toAwsName(name: string): string {
    return `${this.prefix}${name}`;
  }

  private fromAwsName(awsName: string): string | null {
    if (this.prefix === "") return awsName;
    if (!awsName.startsWith(this.prefix)) return null;
    return awsName.slice(this.prefix.length);
  }

  private encodeEnvelope(value: string, tags: string[]): string {
    const env: SecretEnvelope = { value, tags };
    return JSON.stringify(env);
  }

  private decodeEnvelope(payload: string): SecretEnvelope {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed.value === "string") {
        return {
          value: parsed.value,
          tags: Array.isArray(parsed.tags)
            ? parsed.tags.filter(
                (t: unknown): t is string => typeof t === "string",
              )
            : [],
        };
      }
    } catch {
      // Not JSON — treat whole payload as the raw value for compatibility
      // with secrets created outside psst (or with a different tool).
    }
    return { value: payload, tags: [] };
  }

  private buildResourceTags(
    userTags: string[],
  ): Array<{ Key: string; Value: string }> {
    const tags: Array<{ Key: string; Value: string }> = [
      { Key: MANAGED_TAG_KEY, Value: MANAGED_TAG_VALUE },
    ];
    for (const t of userTags) {
      tags.push({
        Key: `${USER_TAG_KEY_PREFIX}${t}`,
        Value: MANAGED_TAG_VALUE,
      });
    }
    return tags;
  }

  /**
   * Check whether an AWS secret exists AND has the psst:managed tag.
   * Returns null if not found, false if found but unmanaged, true if managed.
   */
  private async isManagedSecret(awsName: string): Promise<boolean | null> {
    const { sdk, client } = await this.getClient();
    try {
      const resp: DescribeSecretCommandOutput = await client.send(
        new sdk.DescribeSecretCommand({ SecretId: awsName }),
      );
      const tags = resp.Tags ?? [];
      return tags.some(
        (t) => t.Key === MANAGED_TAG_KEY && t.Value === MANAGED_TAG_VALUE,
      );
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return null;
      // During the ~15s window after ForceDeleteWithoutRecovery, AWS
      // throws InvalidRequestException ("scheduled for deletion") instead
      // of ResourceNotFoundException. Treat it as not-found so callers
      // fall through to createSecretWithRetry which has backoff/restore.
      if (isAwsErrorNamed(err, "InvalidRequestException")) {
        const msg = String(errorMessage(err) ?? "");
        if (/scheduled for deletion/i.test(msg)) return null;
      }
      throw err;
    }
  }

  async exists(name: string): Promise<boolean> {
    const managed = await this.isManagedSecret(this.toAwsName(name));
    return managed === true;
  }

  async setSecret(name: string, value: string, tags?: string[]): Promise<void> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);
    const userTags = tags ?? [];
    const envelope = this.encodeEnvelope(value, userTags);

    // Check existence and ownership BEFORE writing. A secret at this prefix
    // that lacks psst:managed=true was created outside psst — refuse to
    // overwrite it.
    const managed = await this.isManagedSecret(awsName);
    if (managed === false) {
      throw new Error(
        `AWS secret "${awsName}" exists but is not managed by psst. ` +
          `Refusing to overwrite. Remove it manually or use a different prefix.`,
      );
    }

    if (managed === true) {
      // Secret exists and is ours — update it.
      try {
        await client.send(
          new sdk.PutSecretValueCommand({
            SecretId: awsName,
            SecretString: envelope,
          }),
        );
      } catch (err) {
        // A psst-managed secret that was soft-deleted via the AWS console
        // (not psst rm, which force-deletes) is still describable but
        // rejects PutSecretValue. Restore it first, then retry.
        if (isAwsErrorNamed(err, "InvalidRequestException")) {
          const restored = await this.tryRestoreSecret(awsName);
          if (!restored) throw err;
          await client.send(
            new sdk.PutSecretValueCommand({
              SecretId: awsName,
              SecretString: envelope,
            }),
          );
        } else {
          throw err;
        }
      }
      await this.syncResourceTags(awsName, userTags);
      return;
    }

    // managed === null → secret doesn't exist, create it.
    await this.createSecretWithRetry(awsName, envelope, userTags);
  }

  /**
   * CreateSecret retry loop — handles the race where a previous
   * ForceDeleteWithoutRecovery is still propagating (AWS returns
   * InvalidRequestException for ~15s).
   */
  private async createSecretWithRetry(
    awsName: string,
    envelope: string,
    userTags: string[],
  ): Promise<void> {
    const { sdk, client } = await this.getClient();
    const maxAttempts = 4;
    const backoffMs = [0, 2000, 5000, 10000];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (backoffMs[attempt] > 0) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
      }
      try {
        await client.send(
          new sdk.CreateSecretCommand({
            Name: awsName,
            SecretString: envelope,
            Tags: this.buildResourceTags(userTags),
          }),
        );
        return;
      } catch (err) {
        // Scheduled-for-deletion reuse window — retry after backoff
        const msg = String(errorMessage(err) ?? "");
        const isSchedulingRace =
          isAwsErrorNamed(err, "InvalidRequestException") &&
          /scheduled for deletion/i.test(msg);
        if (isSchedulingRace && attempt < maxAttempts - 1) continue;

        // If we hit scheduled-for-deletion, attempt to restore instead of
        // creating — the secret still exists in AWS, it just needs a
        // cancel-delete.
        if (isSchedulingRace) {
          const restored = await this.tryRestoreSecret(awsName);
          if (restored) {
            // Verify the restored secret is psst-managed. A non-psst
            // secret that was soft-deleted would also be restored here;
            // refuse to overwrite it.
            const managed = await this.isManagedSecret(awsName);
            if (managed === false) {
              throw new Error(
                `AWS secret "${awsName}" exists but is not managed by psst. ` +
                  `Refusing to overwrite. Remove it manually or use a different prefix.`,
              );
            }
            await client.send(
              new sdk.PutSecretValueCommand({
                SecretId: awsName,
                SecretString: envelope,
              }),
            );
            await this.syncResourceTags(awsName, userTags);
            return;
          }
          throw new Error(
            `AWS secret "${awsName}" is scheduled for deletion. ` +
              `Retry in a few seconds or restore it via AWS console/CLI.`,
          );
        }
        throw err;
      }
    }
  }

  private async tryRestoreSecret(awsName: string): Promise<boolean> {
    const { sdk, client } = await this.getClient();
    try {
      await client.send(new sdk.RestoreSecretCommand({ SecretId: awsName }));
      return true;
    } catch {
      return false;
    }
  }

  async getSecret(name: string): Promise<string | null> {
    const awsName = this.toAwsName(name);

    // Only return secrets that psst manages, consistent with exists().
    const managed = await this.isManagedSecret(awsName);
    if (managed !== true) return null;

    return this.getSecretValue(name);
  }

  /** Internal: fetch a secret value without the managed-tag check. */
  private async getSecretValue(name: string): Promise<string | null> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    try {
      const result = await client.send(
        new sdk.GetSecretValueCommand({ SecretId: awsName }),
      );
      if (!result.SecretString) return null;
      return this.decodeEnvelope(result.SecretString).value;
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return null;
      throw err;
    }
  }

  async getSecrets(names: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (names.length === 0) return result;

    // Check managed status per name in chunks of 20 (matching the
    // BatchGetSecretValue chunk size). Each isManagedSecret is a single
    // DescribeSecret call. Chunking avoids unbounded fan-out that could
    // trigger AWS ThrottlingException on large batches.
    const CHECK_CHUNK = 20;
    const managedNames: string[] = [];
    for (let i = 0; i < names.length; i += CHECK_CHUNK) {
      // Small delay between chunks to avoid AWS throttling on large vaults.
      if (i > 0) await new Promise((r) => setTimeout(r, 200));
      const chunk = names.slice(i, i + CHECK_CHUNK);
      const checks = await Promise.all(
        chunk.map(async (name) => ({
          name,
          managed: await this.isManagedSecret(this.toAwsName(name)),
        })),
      );
      for (const c of checks) {
        if (c.managed === true) managedNames.push(c.name);
      }
    }
    if (managedNames.length === 0) return result;

    const { sdk, client } = await this.getClient();

    // awsNames is a 1:1 positional mapping of managedNames — same length,
    // same order, just with the AWS prefix applied. Both are sliced with
    // the same `i` index in the loop below, so keep them in sync.
    const awsNames = managedNames.map((n) => this.toAwsName(n));

    // BatchGetSecretValue accepts up to 20 SecretIds per call. Chunk the
    // input so 'psst run' / 'psst exec' over large vaults stays fast.
    const CHUNK = 20;
    for (let i = 0; i < awsNames.length; i += CHUNK) {
      const chunk = awsNames.slice(i, i + CHUNK);
      try {
        const resp: BatchGetSecretValueCommandOutput = await client.send(
          new sdk.BatchGetSecretValueCommand({ SecretIdList: chunk }),
        );
        for (const entry of resp.SecretValues ?? []) {
          if (!entry.Name || entry.SecretString === undefined) continue;
          const logical = this.fromAwsName(entry.Name);
          if (logical === null) continue;
          result.set(logical, this.decodeEnvelope(entry.SecretString).value);
        }
        // resp.Errors lists per-name errors (e.g., ResourceNotFoundException).
        // We silently drop those — callers (run/exec) handle missing secrets
        // via env-var fallback or explicit error messages.
      } catch (err) {
        // BatchGetSecretValue may not be available in every region/SDK
        // version. Fall back to per-name GetSecretValue for this chunk.
        if (
          isAwsErrorNamed(err, "UnknownCommandException") ||
          isAwsErrorNamed(err, "ValidationException")
        ) {
          for (const logical of managedNames.slice(i, i + CHUNK)) {
            // Already verified managed above — skip the redundant
            // DescribeSecret check that getSecret() would do.
            const v = await this.getSecretValue(logical);
            if (v !== null) result.set(logical, v);
          }
          continue;
        }
        throw err;
      }
    }
    return result;
  }

  async listSecrets(filterTags?: string[]): Promise<SecretMetaRecord[]> {
    const { sdk, client } = await this.getClient();

    const secrets: SecretMetaRecord[] = [];
    let nextToken: string | undefined;

    do {
      const resp: ListSecretsCommandOutput = await client.send(
        new sdk.ListSecretsCommand({
          Filters: [
            { Key: "tag-key", Values: [MANAGED_TAG_KEY] },
            // We still filter by name prefix so we don't load every
            // psst:managed=true secret in the account (supports multi-tenant).
            ...(this.prefix
              ? [{ Key: "name" as const, Values: [this.prefix] }]
              : []),
          ],
          NextToken: nextToken,
          MaxResults: 100,
        }),
      );

      for (const entry of resp.SecretList ?? []) {
        if (!entry.Name) continue;
        const logicalName = this.fromAwsName(entry.Name);
        if (logicalName === null) continue;

        // Tags come from AWS resource tags (ListSecrets includes them in
        // each entry's Tags field). The JSON envelope also carries tags
        // but ListSecrets doesn't return SecretString, and doing a
        // GetSecretValue per listed secret would be an N+1. Resource tags
        // are treated as the authoritative source for listing/filtering.
        const tags: string[] = this.extractTagsFromResourceTags(entry.Tags);

        secrets.push({
          name: logicalName,
          tags,
          created_at: this.toIsoString(entry.CreatedDate),
          updated_at: this.toIsoString(
            entry.LastChangedDate ??
              entry.LastAccessedDate ??
              entry.CreatedDate,
          ),
        });
      }

      nextToken = resp.NextToken;
    } while (nextToken);

    // OR-logic tag filter, matching SqliteBackend semantics
    const filtered =
      filterTags && filterTags.length > 0
        ? secrets.filter((s) => s.tags.some((t) => filterTags.includes(t)))
        : secrets;

    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }

  private extractTagsFromResourceTags(
    resourceTags: Array<{ Key?: string; Value?: string }> | undefined,
  ): string[] {
    if (!resourceTags) return [];
    const out: string[] = [];
    for (const t of resourceTags) {
      if (t.Key?.startsWith(USER_TAG_KEY_PREFIX)) {
        out.push(t.Key.slice(USER_TAG_KEY_PREFIX.length));
      }
    }
    return out;
  }

  async getTags(name: string): Promise<string[]> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);
    try {
      const resp: DescribeSecretCommandOutput = await client.send(
        new sdk.DescribeSecretCommand({ SecretId: awsName }),
      );
      return this.extractTagsFromResourceTags(resp.Tags);
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return [];
      throw err;
    }
  }

  /**
   * Reads current tags and the existence state in one DescribeSecret call,
   * so callers don't round-trip twice. Returns null when the secret doesn't
   * exist (caller decides how to surface that).
   */
  private async describeTags(
    awsName: string,
  ): Promise<{ current: string[] } | null> {
    const { sdk, client } = await this.getClient();
    try {
      const resp: DescribeSecretCommandOutput = await client.send(
        new sdk.DescribeSecretCommand({ SecretId: awsName }),
      );
      return { current: this.extractTagsFromResourceTags(resp.Tags) };
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return null;
      throw err;
    }
  }

  /**
   * Replace all user tags on a secret.
   *
   * NOTE: tag-only mutations intentionally update only AWS resource tags,
   * NOT the JSON envelope stored in SecretString. This means the AWSCURRENT
   * envelope's embedded tags may diverge from the live resource tags. This
   * is a deliberate trade-off: rewriting the envelope on every tag change
   * creates a new AWS version (polluting history). Since getTags() reads
   * resource tags (the source of truth) and rollback() restores the
   * historical envelope's tags (correct for that point in time), the
   * divergence is harmless in practice.
   */
  async setTags(name: string, tags: string[]): Promise<boolean> {
    const awsName = this.toAwsName(name);
    const desc = await this.describeTags(awsName);
    if (!desc) return false;
    await this.applyTagDiff(awsName, desc.current, tags);
    return true;
  }

  async addTags(name: string, newTags: string[]): Promise<boolean> {
    const awsName = this.toAwsName(name);
    const desc = await this.describeTags(awsName);
    if (!desc) return false;
    const merged = [...new Set([...desc.current, ...newTags])];
    await this.applyTagDiff(awsName, desc.current, merged);
    return true;
  }

  async removeTags(name: string, tagsToRemove: string[]): Promise<boolean> {
    const awsName = this.toAwsName(name);
    const desc = await this.describeTags(awsName);
    if (!desc) return false;
    const filtered = desc.current.filter((t) => !tagsToRemove.includes(t));
    await this.applyTagDiff(awsName, desc.current, filtered);
    return true;
  }

  /**
   * Issue Tag/UntagResource based on a precomputed diff between current and
   * desired user-tag sets, both expressed as logical tag names. Skips the
   * AWS calls entirely when there's nothing to change.
   */
  private async applyTagDiff(
    awsName: string,
    currentTags: string[],
    desiredTags: string[],
  ): Promise<void> {
    const { sdk, client } = await this.getClient();
    const currentKeys = new Set(
      currentTags.map((t) => `${USER_TAG_KEY_PREFIX}${t}`),
    );
    const desiredKeys = new Set(
      desiredTags.map((t) => `${USER_TAG_KEY_PREFIX}${t}`),
    );

    const toRemove = [...currentKeys].filter((k) => !desiredKeys.has(k));
    const toAdd = [...desiredKeys].filter((k) => !currentKeys.has(k));

    if (toRemove.length > 0) {
      await client.send(
        new sdk.UntagResourceCommand({
          SecretId: awsName,
          TagKeys: toRemove,
        }),
      );
    }
    if (toAdd.length > 0) {
      await client.send(
        new sdk.TagResourceCommand({
          SecretId: awsName,
          Tags: toAdd.map((Key) => ({ Key, Value: MANAGED_TAG_VALUE })),
        }),
      );
    }
  }

  /**
   * Used by setSecret after PutSecretValue to keep resource tags aligned
   * with the tags baked into the envelope we just wrote. Does one
   * DescribeSecret to read the current tag set, then diffs.
   */
  private async syncResourceTags(
    awsName: string,
    userTags: string[],
  ): Promise<void> {
    const { sdk, client } = await this.getClient();
    const desc: DescribeSecretCommandOutput = await client.send(
      new sdk.DescribeSecretCommand({ SecretId: awsName }),
    );
    const currentTags = this.extractTagsFromResourceTags(desc.Tags);
    await this.applyTagDiff(awsName, currentTags, userTags);
  }

  async getHistory(name: string): Promise<SecretHistoryRecord[]> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    const versions = await this.listAllVersions(awsName);
    if (versions === null) return [];

    // Identify the current version — any entry with AWSCURRENT stage.
    // Exclude it from the history list (it represents the live secret).
    const nonCurrent = versions.filter(
      (v) => !(v.VersionStages ?? []).includes("AWSCURRENT"),
    );

    // Sort oldest -> newest by CreatedDate
    nonCurrent.sort(
      (a, b) =>
        (a.CreatedDate ? a.CreatedDate.getTime() : 0) -
        (b.CreatedDate ? b.CreatedDate.getTime() : 0),
    );

    // Fetch each historical envelope to recover the tags that were in
    // effect at archival time (matches SqliteBackend.getHistory, whose
    // rows carry their own archived tags column). This is O(history),
    // but history lists are capped at 100 AWS versions per secret and
    // history is called rarely (interactive 'psst history <name>').
    // Chunk at 20 concurrent fetches to avoid AWS ThrottlingException.
    const envelopes: Array<{ tags: string[] }> = [];
    const HISTORY_CHUNK = 20;
    for (let i = 0; i < nonCurrent.length; i += HISTORY_CHUNK) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200));
      const chunk = nonCurrent.slice(i, i + HISTORY_CHUNK);
      const batch = await Promise.all(
        chunk.map(async (v) => {
          if (!v.VersionId) return { tags: [] as string[] };
          try {
            const resp: GetSecretValueCommandOutput = await client.send(
              new sdk.GetSecretValueCommand({
                SecretId: awsName,
                VersionId: v.VersionId,
              }),
            );
            if (!resp.SecretString) return { tags: [] as string[] };
            return { tags: this.decodeEnvelope(resp.SecretString).tags };
          } catch {
            return { tags: [] as string[] };
          }
        }),
      );
      envelopes.push(...batch);
    }

    // Assign monotonic version numbers (oldest = 1), then return in
    // newest-first order to match SqliteBackend.getHistory().
    const numbered: SecretHistoryRecord[] = nonCurrent.map((v, idx) => ({
      version: idx + 1,
      tags: envelopes[idx].tags,
      archived_at: this.toIsoString(v.CreatedDate),
    }));

    return numbered.reverse();
  }

  async getHistoryVersion(
    name: string,
    version: number,
  ): Promise<string | null> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    const versionId = await this.resolveVersionId(awsName, version);
    if (!versionId) return null;

    try {
      const resp: GetSecretValueCommandOutput = await client.send(
        new sdk.GetSecretValueCommand({
          SecretId: awsName,
          VersionId: versionId,
        }),
      );
      if (!resp.SecretString) return null;
      return this.decodeEnvelope(resp.SecretString).value;
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return null;
      throw err;
    }
  }

  private async resolveVersionId(
    awsName: string,
    version: number,
  ): Promise<string | null> {
    const versions = await this.listAllVersions(awsName);
    if (versions === null) return null;

    const nonCurrent = versions.filter(
      (v) => !(v.VersionStages ?? []).includes("AWSCURRENT"),
    );
    nonCurrent.sort(
      (a, b) =>
        (a.CreatedDate ? a.CreatedDate.getTime() : 0) -
        (b.CreatedDate ? b.CreatedDate.getTime() : 0),
    );

    const target = nonCurrent[version - 1];
    return target?.VersionId ?? null;
  }

  /**
   * Page through every version of an AWS secret. Returns null if the secret
   * doesn't exist; otherwise the full, unsorted list.
   */
  private async listAllVersions(awsName: string): Promise<Array<{
    VersionId?: string;
    CreatedDate?: Date;
    VersionStages?: string[];
  }> | null> {
    const { sdk, client } = await this.getClient();
    const all: Array<{
      VersionId?: string;
      CreatedDate?: Date;
      VersionStages?: string[];
    }> = [];
    let nextToken: string | undefined;
    do {
      let resp: ListSecretVersionIdsCommandOutput;
      try {
        resp = await client.send(
          new sdk.ListSecretVersionIdsCommand({
            SecretId: awsName,
            IncludeDeprecated: true,
            NextToken: nextToken,
          }),
        );
      } catch (err) {
        if (isAwsErrorNamed(err, "ResourceNotFoundException")) return null;
        throw err;
      }
      for (const v of resp.Versions ?? []) all.push(v);
      nextToken = resp.NextToken;
    } while (nextToken);
    return all;
  }

  async rollback(name: string, targetVersion: number): Promise<boolean> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    // Resolve the target version and fetch its full envelope (not just the
    // value) so we can restore the tags that were in effect at archival time.
    // This matches SqliteBackend.rollback(), which restores historyRow.tags.
    const versionId = await this.resolveVersionId(awsName, targetVersion);
    if (!versionId) return false;

    let envelope: SecretEnvelope;
    try {
      const resp: GetSecretValueCommandOutput = await client.send(
        new sdk.GetSecretValueCommand({
          SecretId: awsName,
          VersionId: versionId,
        }),
      );
      if (!resp.SecretString) return false;
      envelope = this.decodeEnvelope(resp.SecretString);
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return false;
      throw err;
    }

    // Restore both value and tags from the historical version.
    // Catch the specific ownership-guard error from setSecret so that a
    // concurrent psst:managed tag removal (e.g., via the AWS console)
    // returns false instead of throwing, matching the boolean contract.
    // All other errors (network, credentials, service) propagate normally.
    try {
      await this.setSecret(name, envelope.value, envelope.tags);
    } catch (err) {
      if (err instanceof Error && /not managed by psst/i.test(err.message)) {
        return false;
      }
      throw err;
    }
    return true;
  }

  async clearHistory(_name: string): Promise<void> {
    // AWS Secrets Manager manages version lifecycle itself (limited to
    // 100 versions per secret, older ones expire automatically). There
    // is no public API to forcibly delete historical versions while
    // keeping the current one, so this is a no-op for the AWS backend.
    // Callers should treat clearHistory() as advisory across backends.
  }

  /**
   * Remove a secret from AWS Secrets Manager.
   *
   * We use ForceDeleteWithoutRecovery=true to match 'psst rm' semantics
   * (immediate deletion, no soft-delete window). AWS enforces a ~15s
   * window during which the same name cannot be reused; setSecret()
   * handles that by retrying (or restoring if scheduled).
   */
  async removeSecret(name: string): Promise<boolean> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    // Only delete secrets that psst manages. An unmanaged secret at this
    // prefix was created outside psst — treat it as "not found" rather
    // than permanently destroying someone else's data.
    const managed = await this.isManagedSecret(awsName);
    if (managed !== true) return false;

    try {
      await client.send(
        new sdk.DeleteSecretCommand({
          SecretId: awsName,
          ForceDeleteWithoutRecovery: true,
        }),
      );
      return true;
    } catch (err) {
      if (isAwsErrorNamed(err, "ResourceNotFoundException")) return false;
      throw err;
    }
  }

  close(): void {
    // AWS SDK clients don't require explicit cleanup.
    this.client = null;
  }

  private toIsoString(date: Date | string | undefined | null): string {
    if (!date) return new Date(0).toISOString();
    if (date instanceof Date) return date.toISOString();
    return new Date(date).toISOString();
  }
}

/**
 * Initialize an AWS-backed vault. We only need to sanity-check that the
 * region can be resolved — actual AWS auth is validated lazily on first call.
 */
export function initializeAwsVault(config: AwsBackendConfig | undefined): {
  success: boolean;
  error?: string;
} {
  const region = resolveAwsRegion(config);
  if (!region) {
    return {
      success: false,
      error:
        "AWS region not configured. Set aws.region in config.json, or export AWS_REGION / AWS_DEFAULT_REGION.",
    };
  }
  return { success: true };
}
