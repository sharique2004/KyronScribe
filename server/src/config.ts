// Typed application config with an async init pattern.
// Precedence: process.env (dotenv locally) < AWS Secrets Manager (prod, secret values win).
// `loadConfig()` is called exactly once at boot (index.ts / scripts) before anything reads config.
import { config as loadDotenv } from 'dotenv';

/** Supported AI providers for note generation. */
export type AiProvider = 'gemini' | 'anthropic' | 'mock';

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlHours: number;
  port: number;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  /** Configured provider (explicit AI_PROVIDER, else inferred from which keys exist). */
  aiProvider: AiProvider;
  scribeModel: string;
  scribeMock: boolean;
  nodeEnv: string;
}

/**
 * The provider a generation request will ACTUALLY use: SCRIBE_MOCK forces mock, and a
 * configured provider without its API key degrades to mock (never a hard failure).
 * Shared by the generate route (runner choice + audit meta) and the health payload.
 */
export function effectiveProvider(cfg: AppConfig): AiProvider {
  if (cfg.scribeMock) return 'mock';
  if (cfg.aiProvider === 'gemini') return cfg.geminiApiKey ? 'gemini' : 'mock';
  if (cfg.aiProvider === 'anthropic') return cfg.anthropicApiKey ? 'anthropic' : 'mock';
  return 'mock';
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

  const anthropicApiKey = source.ANTHROPIC_API_KEY || undefined;
  const geminiApiKey = source.GEMINI_API_KEY || undefined;

  // Provider resolution: explicit AI_PROVIDER wins; otherwise infer from which keys
  // are present (Gemini preferred), falling back to mock when no key is configured.
  const explicit = (source.AI_PROVIDER || '').toLowerCase();
  let aiProvider: AiProvider;
  if (explicit === 'gemini' || explicit === 'anthropic' || explicit === 'mock') {
    aiProvider = explicit;
  } else if (explicit) {
    throw new Error(`AI_PROVIDER must be one of gemini|anthropic|mock, got "${explicit}"`);
  } else {
    aiProvider = geminiApiKey ? 'gemini' : anthropicApiKey ? 'anthropic' : 'mock';
  }

  cached = {
    databaseUrl,
    jwtSecret,
    jwtTtlHours: toNumber(source.JWT_TTL_HOURS, 12),
    port: toNumber(source.PORT, 4000),
    anthropicApiKey,
    geminiApiKey,
    aiProvider,
    // Provider-aware default: Gemini Flash for gemini, Sonnet for anthropic/mock.
    scribeModel:
      source.SCRIBE_MODEL || (aiProvider === 'gemini' ? 'gemini-3.6-flash' : 'claude-sonnet-5'),
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
