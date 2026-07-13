import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { config } from "../config";
import { initS3 } from "../s3";

export const backendRoot = path.resolve(__dirname, "../../");
export const uploadDir = path.resolve(__dirname, "../../uploads");
export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_PAGE_SIZE = 200;
export const MAX_IMPORT_ARCHIVE_ENTRIES = 6000;
export const MAX_IMPORT_COLLECTIONS = 1000;
export const MAX_IMPORT_DRAWINGS = 5000;
export const MAX_IMPORT_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_DRAWING_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_TOTAL_EXTRACTED_BYTES = 120 * 1024 * 1024;

const redactDatabaseUrl = (value: string | undefined): string => {
  if (!value) return "<unset>";
  if (value.startsWith("file:")) return value;
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<redacted>";
  }
};

console.log("Resolved DATABASE_URL:", redactDatabaseUrl(process.env.DATABASE_URL));
if (config.s3.bucket) {
  initS3({
    bucket: config.s3.bucket,
    region: config.s3.region,
    endpoint: config.s3.endpoint ?? undefined,
    publicUrl: config.s3.publicUrl ?? undefined,
    forcePathStyle: config.s3.forcePathStyle,
    accessKeyId: config.s3.accessKeyId ?? undefined,
    secretAccessKey: config.s3.secretAccessKey ?? undefined,
  });
  console.log("S3 image storage enabled", {
    bucket: config.s3.bucket,
    region: config.s3.region,
  });
}

const normalizeOrigins = (rawOrigins?: string | null): string[] => {
  const fallback = "http://localhost:6767";
  if (!rawOrigins || rawOrigins.trim().length === 0) return [fallback];
  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => (/^https?:\/\//i.test(origin) ? origin : `http://${origin}`))
    .map((origin) => (origin.endsWith("/") ? origin.slice(0, -1) : origin));
  return origins.length > 0 ? origins : [fallback];
};

export const allowedOrigins = normalizeOrigins(config.frontendUrl);
console.log("Allowed origins:", allowedOrigins);
const isDev = (process.env.NODE_ENV || "development") !== "production";
export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin || allowedOrigins.includes(origin)) return true;
  return Boolean(
    isDev &&
      (/^http:\/\/localhost:\d+$/i.test(origin) ||
        /^http:\/\/127\.0\.0\.1:\d+$/i.test(origin)),
  );
};

let cachedBackendVersion: string | null = null;
export const getBackendVersion = (): string => {
  if (cachedBackendVersion) return cachedBackendVersion;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(backendRoot, "package.json"), "utf8"),
    ) as { version?: string };
    cachedBackendVersion =
      typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    cachedBackendVersion = "unknown";
  }
  return cachedBackendVersion;
};

export const initializeUploadDir = async () => {
  try {
    await fsPromises.mkdir(uploadDir, { recursive: true });
  } catch (error) {
    console.error("Failed to create upload directory:", error);
  }
};
