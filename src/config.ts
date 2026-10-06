import "dotenv/config";
import { z } from "zod/v4";
// Inlined from @synapsvault/registry-client (local package — avoids runtime resolution issues)
type StellarDeploymentNetwork = "testnet" | "mainnet";

const NETWORK_PRESETS = {
  testnet: {
    x402Network: "stellar:testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    usdcSacContractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  },
  mainnet: {
    x402Network: "stellar:pubnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    sorobanRpcUrl: "https://soroban.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
    usdcSacContractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  },
} as const;

function resolveStellarNetwork(value: string | undefined): StellarDeploymentNetwork {
  const v = (value ?? "testnet").trim().toLowerCase();
  return v === "mainnet" || v === "pubnet" || v === "public" ? "mainnet" : "testnet";
}

function applyNetworkEnvDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const network = resolveStellarNetwork(env.STELLAR_NETWORK);
  const preset = NETWORK_PRESETS[network];
  return {
    ...env,
    STELLAR_NETWORK: network,
    NETWORK: env.NETWORK ?? preset.x402Network,
    SOROBAN_RPC_URL: env.SOROBAN_RPC_URL ?? preset.sorobanRpcUrl,
    USDC_CONTRACT_ID: env.USDC_CONTRACT_ID ?? preset.usdcSacContractId,
  };
}

function validateNetworkConfig(_input: Record<string, unknown>): string[] {
  return []; // Network validation is handled via env var schema below
}
import { rootLogger } from "./lib/logger.js";

const envWithDefaults = applyNetworkEnvDefaults(process.env);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4021),
  BASE_URL: z.string().default("http://localhost:4021"),
  WEB_APP_URL: z.string().url().or(z.literal("")).default("http://localhost:5173"),
  ALLOWED_ORIGINS: z.string().optional(),

  // Stellar / x402 — STELLAR_NETWORK selects preset defaults; individual vars may override.
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NETWORK: z.string().min(1),
  FACILITATOR_URL: z.string().default("https://www.x402.org/facilitator"),
  PAY_TO: z.string().min(1, "PAY_TO (platform wallet address) is required"),
  AGENT_SECRET_KEY: z.string().min(1, "AGENT_SECRET_KEY (platform agent secret) is required"),
  USDC_CONTRACT_ID: z.string().min(1),

  // Soroban / vault-registry
  SOROBAN_RPC_URL: z.string().min(1, "SOROBAN_RPC_URL is required"),
  VAULT_REGISTRY_CONTRACT_ID: z.string().min(1, "VAULT_REGISTRY_CONTRACT_ID is required"),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4"),

  // Supabase
  DATABASE_URL: z.string().min(1, "DATABASE_URL (Supabase Postgres connection string) is required"),
  SUPABASE_URL: z.string().min(1, "SUPABASE_URL is required"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY is required"),
  SUPABASE_STORAGE_BUCKET: z.string().default("resources"),

  // Limits
  MAX_FILE_SIZE_MB: z.coerce.number().default(50),
  // Explicit JSON body limit for express.json() (e.g. "1mb", "512kb").
  MAX_JSON_BODY_SIZE: z.string().default("1mb"),
  // Comma-separated allowlist of accepted upload content types (#87).
  ALLOWED_UPLOAD_MIME_TYPES: z
    .string()
    .default(
      "application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,application/json,application/zip,video/mp4,audio/mpeg",
    ),

  // Soroban registry
  REGISTRY_CONTRACT_ID: z.string().min(1, "REGISTRY_CONTRACT_ID is required"),
  REGISTRY_SECRET_KEY: z
    .string()
    .min(1, "REGISTRY_SECRET_KEY (deployer / owner secret) is required"),

  // Metrics endpoint token — if set, requests to /metrics must supply it via
  // Bearer auth or ?token=. If unset, the endpoint is disabled.
  METRICS_TOKEN: z.string().optional(),

  // Sentry error tracking — when DSN is set, unhandled errors are reported.
  SENTRY_DSN: z.string().url().optional().or(z.literal("")),

  // Verification
  VERIFICATION_PRICE: z.string().default("0.10"),
  // OpenRouter token pricing (USD per 1M tokens) used to estimate the cost of
  // each verification (#283). Defaults track anthropic/claude-sonnet-4 list
  // pricing; override per model if you change OPENROUTER_MODEL.
  VERIFICATION_PROMPT_COST_PER_1M: z.coerce.number().nonnegative().default(3),
  VERIFICATION_COMPLETION_COST_PER_1M: z.coerce.number().nonnegative().default(15),

  // Rate limiting (verify-content + publish)
  RATE_LIMIT_VERIFY_IP_MAX: z.coerce.number().default(10),
  RATE_LIMIT_VERIFY_IP_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_VERIFY_WALLET_MAX: z.coerce.number().default(5),
  RATE_LIMIT_VERIFY_WALLET_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_PUBLISH_IP_MAX: z.coerce.number().default(20),
  RATE_LIMIT_PUBLISH_IP_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_PUBLISH_WALLET_MAX: z.coerce.number().default(10),
  RATE_LIMIT_PUBLISH_WALLET_WINDOW_MS: z.coerce.number().default(3_600_000),
  // Default per-publisher rate limit applied when a publisher has no override.
  RATE_LIMIT_PUBLISHER_MAX: z.coerce.number().default(30),
  RATE_LIMIT_PUBLISHER_WINDOW_MS: z.coerce.number().default(60_000),

  // Optional Redis URL for a shared sliding-window rate-limit store (multi-instance).
  REDIS_URL: z.string().url().optional(),

  // Optional HMAC-SHA256 request signatures for publisher mutations (off by default).
  REQUIRE_REQUEST_SIGNATURE: z.coerce.boolean().default(false),
  // Max clock skew for X-Timestamp when signatures are required (default 5 minutes).
  SIGNATURE_MAX_SKEW_MS: z.coerce.number().default(300_000),

  // Per-request timeout — slow upstreams (RPC, facilitator) return 503 instead
  // of hanging the connection.
  REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
  // Max time to drain in-flight requests on SIGTERM/SIGINT before forcing exit.
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(10_000),
  // How long a publish Idempotency-Key is remembered so retries return the
  // original result instead of creating a duplicate (default 24h).
  IDEMPOTENCY_TTL_MS: z.coerce.number().default(86_400_000),
  // Short-lived cache for catalog/preview reads to cut DB load. Kept low so
  // newly published/delisted resources surface quickly.
  CATALOG_CACHE_TTL_MS: z.coerce.number().default(10_000),
  // Max distinct filter/sort/pagination combinations cached for the catalog
  // (#316). Bounds key cardinality; oldest entries are evicted (FIFO).
  CATALOG_CACHE_MAX_KEYS: z.coerce.number().int().min(1).default(200),
});

const parsed = envSchema.safeParse(envWithDefaults);

if (!parsed.success) {
  rootLogger.error(
    { event: "config_invalid", issues: parsed.error.format() },
    "invalid environment variables",
  );
  process.exit(1);
}

const stellarNetwork = resolveStellarNetwork(parsed.data.STELLAR_NETWORK);
const networkIssues = validateNetworkConfig({
  stellarNetwork,
  x402Network: parsed.data.NETWORK,
  sorobanRpcUrl: parsed.data.SOROBAN_RPC_URL,
  usdcSacContractId: parsed.data.USDC_CONTRACT_ID,
  registryContractId: parsed.data.VAULT_REGISTRY_CONTRACT_ID,
});

if (networkIssues.length > 0) {
  rootLogger.error(
    { event: "config_network_mismatch", issues: networkIssues },
    "inconsistent Stellar network configuration",
  );
  for (const issue of networkIssues) {
    rootLogger.error({ field: issue.field }, issue.message);
  }
  process.exit(1);
}

export const config = parsed.data;