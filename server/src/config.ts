// Typed application config with an async init pattern.
// Precedence: process.env (dotenv locally) < AWS Secrets Manager (prod, secret values win).
// `loadConfig()` is called exactly once at boot (index.ts / scripts) before anything reads config.
import { config as loadDotenv } from 'dotenv';

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlHours: number;
  port: number;
  anthropicApiKey?: string;
  scribeModel: string;
  scribeMock: boolean;
  nodeEnv: string;
}

let cached: AppConfig | null = null;

/** Fetch and parse a JSON secret from AWS Secrets Manager using instance-role credentials. */
async function fetchSecret(secretName: string): Promise<Record<string, string>> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  if (!result.SecretString) return {};
  const parsed = JSON.parse(result.SecretString) as unknown;
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Secret ${secretName} is not a JSON object`);
  }
  return parsed as Record<string, string>;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Expected a number but got "${value}"`);
  return n;
}

function toBool(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Load config once. Idempotent — subsequent calls return the cached instance. */
export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;

  loadDotenv();

  let source: Record<string, string | undefined> = { ...process.env };
  const secretName = process.env.AWS_SECRETS_NAME;
  if (secretName) {
    const secret = await fetchSecret(secretName);
    source = { ...source, ...secret }; // secret values take precedence over env
  }

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const jwtSecret = source.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  cached = {
    databaseUrl,
    jwtSecret,
    jwtTtlHours: toNumber(source.JWT_TTL_HOURS, 12),
    port: toNumber(source.PORT, 4000),
    anthropicApiKey: source.ANTHROPIC_API_KEY || undefined,
    scribeModel: source.SCRIBE_MODEL || 'claude-sonnet-5',
    scribeMock: toBool(source.SCRIBE_MOCK),
    nodeEnv: source.NODE_ENV || 'development',
  };
  return cached;
}

/** Synchronous accessor for already-loaded config. Throws if `loadConfig()` has not run. */
export function getConfig(): AppConfig {
  if (!cached) throw new Error('Config not loaded — call loadConfig() before getConfig()');
  return cached;
}
