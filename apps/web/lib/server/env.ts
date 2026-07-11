export interface ServerEnv {
  mongodbUri: string;
  mongodbDb: string;
  gcliBaseUrl: string;
  gcliApiKeys: string;
  gcliModel: string;
  gcliModels: string[];
  gcliStrategy: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  r2PublicBaseUrl?: string;
  railwayWorkerUrl?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getServerEnv(): ServerEnv {
  const gcliApiKeys =
    process.env.GCLI_API_KEYS ??
    process.env.GCLI_API_KEY ??
    process.env.GEMINI_API_KEY;

  if (!gcliApiKeys) {
    throw new Error(
      "Missing required environment variable: GCLI_API_KEYS (or GCLI_API_KEY / GEMINI_API_KEY)"
    );
  }

  const gcliModel = process.env.GCLI_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  const gcliModels = (process.env.GCLI_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (!gcliModels.includes(gcliModel)) gcliModels.unshift(gcliModel);

  return {
    mongodbUri: requiredEnv("MONGODB_URI"),
    mongodbDb: process.env.MONGODB_DB ?? "helpdesk_rag",
    gcliBaseUrl: process.env.GCLI_BASE_URL ?? "https://gcli.ggchan.dev/v1",
    gcliApiKeys,
    gcliModel,
    gcliModels,
    gcliStrategy: process.env.GCLI_ROTATION_STRATEGY ?? "swrr",
    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2BucketName: process.env.R2_BUCKET_NAME,
    r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    railwayWorkerUrl: process.env.RAILWAY_WORKER_URL
  };
}

export function requireR2Env() {
  const env = getServerEnv();
  const missing = [
    ["R2_ACCOUNT_ID", env.r2AccountId],
    ["R2_ACCESS_KEY_ID", env.r2AccessKeyId],
    ["R2_SECRET_ACCESS_KEY", env.r2SecretAccessKey],
    ["R2_BUCKET_NAME", env.r2BucketName]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing R2 environment variables: ${missing.map(([name]) => name).join(", ")}`);
  }

  return {
    accountId: env.r2AccountId as string,
    accessKeyId: env.r2AccessKeyId as string,
    secretAccessKey: env.r2SecretAccessKey as string,
    bucketName: env.r2BucketName as string,
    publicBaseUrl: env.r2PublicBaseUrl
  };
}
