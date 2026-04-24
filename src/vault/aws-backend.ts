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

import type {
  SecretHistoryRecord,
  SecretMetaRecord,
  VaultBackend,
} from "./backend.js";
import type { AwsBackendConfig } from "./config.js";
import { resolveAwsPrefix, resolveAwsRegion } from "./config.js";

// We dynamically import the AWS SDK so users without AWS configured never
// pay the cold-start cost and so Bun's `--compile` doesn't drag it in.
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
  private async getClient(): Promise<{ sdk: AwsSdk; client: SecretsManagerClient }> {
    if (this.client && this.sdk) return { sdk: this.sdk, client: this.client };

    try {
      this.sdk = (await import("@aws-sdk/client-secrets-manager")) as AwsSdk;
    } catch (err: any) {
      throw new Error(
        `AWS backend requires @aws-sdk/client-secrets-manager. ` +
          `Install it: npm install @aws-sdk/client-secrets-manager. (${err.message})`,
      );
    }

    const clientConfig: Record<string, unknown> = {};
    if (this.region) clientConfig.region = this.region;

    if (this.profile) {
      try {
        const credsMod = await import("@aws-sdk/credential-providers");
        clientConfig.credentials = (credsMod as any).fromNodeProviderChain({
          profile: this.profile,
        });
      } catch {
        // Fallback: the main SDK exposes fromIni via the default chain;
        // if credential-providers isn't installed, let the default chain run
        // with AWS_PROFILE env var instead.
        process.env.AWS_PROFILE = this.profile;
      }
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
            ? parsed.tags.filter((t: unknown): t is string => typeof t === "string")
            : [],
        };
      }
    } catch {
      // Not JSON — treat whole payload as the raw value for compatibility
      // with secrets created outside psst (or with a different tool).
    }
    return { value: payload, tags: [] };
  }

  private buildResourceTags(userTags: string[]): Array<{ Key: string; Value: string }> {
    const tags: Array<{ Key: string; Value: string }> = [
      { Key: MANAGED_TAG_KEY, Value: MANAGED_TAG_VALUE },
    ];
    for (const t of userTags) {
      tags.push({ Key: `${USER_TAG_KEY_PREFIX}${t}`, Value: MANAGED_TAG_VALUE });
    }
    return tags;
  }

  async setSecret(name: string, value: string, tags?: string[]): Promise<void> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);
    const userTags = tags ?? [];
    const envelope = this.encodeEnvelope(value, userTags);

    // Try to update first; if not found, create.
    try {
      await client.send(
        new sdk.PutSecretValueCommand({
          SecretId: awsName,
          SecretString: envelope,
        }),
      );
      // Sync user tags separately (PutSecretValue doesn't touch tags)
      await this.syncResourceTags(awsName, userTags);
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") {
        await client.send(
          new sdk.CreateSecretCommand({
            Name: awsName,
            SecretString: envelope,
            Tags: this.buildResourceTags(userTags),
          }),
        );
        return;
      }
      throw err;
    }
  }

  async getSecret(name: string): Promise<string | null> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    try {
      const result = await client.send(
        new sdk.GetSecretValueCommand({ SecretId: awsName }),
      );
      if (!result.SecretString) return null;
      return this.decodeEnvelope(result.SecretString).value;
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return null;
      throw err;
    }
  }

  async getSecrets(names: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const name of names) {
      const value = await this.getSecret(name);
      if (value !== null) result.set(name, value);
    }
    return result;
  }

  async listSecrets(filterTags?: string[]): Promise<SecretMetaRecord[]> {
    const { sdk, client } = await this.getClient();

    const secrets: SecretMetaRecord[] = [];
    let nextToken: string | undefined;

    do {
      const resp: any = await client.send(
        new sdk.ListSecretsCommand({
          Filters: [
            { Key: "tag-key", Values: [MANAGED_TAG_KEY] },
            // We still filter by name prefix so we don't load every
            // psst:managed=true secret in the account (supports multi-tenant).
            ...(this.prefix
              ? [{ Key: "name", Values: [this.prefix] } as any]
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

        // Prefer tags from the JSON payload (authoritative, avoids one
        // extra API call per secret). Fall back to resource tags if the
        // payload wasn't written by psst.
        let tags: string[] = this.extractTagsFromResourceTags(entry.Tags);

        secrets.push({
          name: logicalName,
          tags,
          created_at: this.toIsoString(entry.CreatedDate),
          updated_at: this.toIsoString(
            entry.LastChangedDate ?? entry.LastAccessedDate ?? entry.CreatedDate,
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
      if (t.Key && t.Key.startsWith(USER_TAG_KEY_PREFIX)) {
        out.push(t.Key.slice(USER_TAG_KEY_PREFIX.length));
      }
    }
    return out;
  }

  async getTags(name: string): Promise<string[]> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);
    try {
      const resp: any = await client.send(
        new sdk.DescribeSecretCommand({ SecretId: awsName }),
      );
      return this.extractTagsFromResourceTags(resp.Tags);
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return [];
      throw err;
    }
  }

  async setTags(name: string, tags: string[]): Promise<boolean> {
    const awsName = this.toAwsName(name);
    // Ensure the secret exists
    const { sdk, client } = await this.getClient();
    try {
      await client.send(new sdk.DescribeSecretCommand({ SecretId: awsName }));
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return false;
      throw err;
    }

    await this.syncResourceTags(awsName, tags);

    // Also update the JSON envelope so the tags on the payload match.
    // We read current value, rewrite envelope with new tags.
    try {
      const current = await client.send(
        new sdk.GetSecretValueCommand({ SecretId: awsName }),
      );
      const existing =
        current.SecretString !== undefined
          ? this.decodeEnvelope(current.SecretString)
          : { value: "", tags: [] };
      await client.send(
        new sdk.PutSecretValueCommand({
          SecretId: awsName,
          SecretString: this.encodeEnvelope(existing.value, tags),
        }),
      );
    } catch {
      // Payload rewrite is best-effort; resource tags are the source of truth
      // for list/filter queries.
    }

    return true;
  }

  async addTags(name: string, newTags: string[]): Promise<boolean> {
    const existing = await this.getTags(name);
    const merged = [...new Set([...existing, ...newTags])];
    return this.setTags(name, merged);
  }

  async removeTags(name: string, tagsToRemove: string[]): Promise<boolean> {
    const existing = await this.getTags(name);
    const filtered = existing.filter((t) => !tagsToRemove.includes(t));
    return this.setTags(name, filtered);
  }

  private async syncResourceTags(awsName: string, userTags: string[]): Promise<void> {
    const { sdk, client } = await this.getClient();

    // Read current tags to compute diff
    const desc: any = await client.send(
      new sdk.DescribeSecretCommand({ SecretId: awsName }),
    );
    const currentUserTagKeys = (desc.Tags ?? [])
      .map((t: any) => t.Key as string | undefined)
      .filter(
        (k: string | undefined): k is string =>
          !!k && k.startsWith(USER_TAG_KEY_PREFIX),
      );
    const desiredUserTagKeys = new Set(
      userTags.map((t) => `${USER_TAG_KEY_PREFIX}${t}`),
    );

    const toRemove = currentUserTagKeys.filter(
      (k: string) => !desiredUserTagKeys.has(k),
    );
    const toAdd = [...desiredUserTagKeys].filter(
      (k) => !currentUserTagKeys.includes(k),
    );

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

  async getHistory(name: string): Promise<SecretHistoryRecord[]> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    let resp: any;
    try {
      resp = await client.send(
        new sdk.ListSecretVersionIdsCommand({
          SecretId: awsName,
          IncludeDeprecated: true,
        }),
      );
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return [];
      throw err;
    }

    const versions = (resp.Versions ?? []) as Array<{
      VersionId?: string;
      CreatedDate?: Date;
      VersionStages?: string[];
    }>;

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

    // Assign monotonic version numbers (oldest = 1), then return in
    // newest-first order to match SqliteBackend.getHistory().
    const numbered: SecretHistoryRecord[] = nonCurrent.map((v, idx) => ({
      version: idx + 1,
      tags: [], // AWS versions don't carry tags; we'd need to fetch each one
      archived_at: this.toIsoString(v.CreatedDate),
    }));

    return numbered.reverse();
  }

  async getHistoryVersion(name: string, version: number): Promise<string | null> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    const versionId = await this.resolveVersionId(awsName, version);
    if (!versionId) return null;

    try {
      const resp: any = await client.send(
        new sdk.GetSecretValueCommand({
          SecretId: awsName,
          VersionId: versionId,
        }),
      );
      if (!resp.SecretString) return null;
      return this.decodeEnvelope(resp.SecretString).value;
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return null;
      throw err;
    }
  }

  private async resolveVersionId(
    awsName: string,
    version: number,
  ): Promise<string | null> {
    const { sdk, client } = await this.getClient();

    let resp: any;
    try {
      resp = await client.send(
        new sdk.ListSecretVersionIdsCommand({
          SecretId: awsName,
          IncludeDeprecated: true,
        }),
      );
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return null;
      throw err;
    }

    const versions = (resp.Versions ?? []) as Array<{
      VersionId?: string;
      CreatedDate?: Date;
      VersionStages?: string[];
    }>;

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

  async rollback(name: string, targetVersion: number): Promise<boolean> {
    const value = await this.getHistoryVersion(name, targetVersion);
    if (value === null) return false;

    // Preserve current tags on rollback (matches SqliteBackend behavior
    // where rollback only restores the value; tags travel with the row).
    const currentTags = await this.getTags(name);
    await this.setSecret(name, value, currentTags);
    return true;
  }

  async clearHistory(_name: string): Promise<void> {
    // AWS Secrets Manager manages version lifecycle itself (limited to
    // 100 versions per secret, older ones expire automatically). There
    // is no public API to forcibly delete historical versions while
    // keeping the current one, so this is a no-op for the AWS backend.
    // Callers should treat clearHistory() as advisory across backends.
  }

  async removeSecret(name: string): Promise<boolean> {
    const { sdk, client } = await this.getClient();
    const awsName = this.toAwsName(name);

    try {
      await client.send(
        new sdk.DeleteSecretCommand({
          SecretId: awsName,
          ForceDeleteWithoutRecovery: true,
        }),
      );
      return true;
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") return false;
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
export function initializeAwsVault(
  config: AwsBackendConfig | undefined,
): { success: boolean; error?: string } {
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
