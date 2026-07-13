import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import multer from "multer";
import { PrismaClient, Prisma } from "./generated/client";
import {
  validateImportedDrawing,
  sanitizeText,
} from "./security";
import { config } from "./config";
import { authModeService, requireAuth, optionalAuth } from "./middleware/auth";
import { errorHandler, asyncHandler } from "./middleware/errorHandler";
import authRouter from "./auth";
import { logAuditEvent } from "./utils/audit";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerImportExportRoutes } from "./routes/importExport";
import { registerSystemRoutes } from "./routes/system";
import { registerFileRoutes } from "./routes/files";
import { registerStorageRoutes } from "./routes/storage";
import { prisma, configureSqlite } from "./db/prisma";
import { createDrawingsCacheStore } from "./server/drawingsCache";
import { registerSocketHandlers } from "./server/socket";
import { issueBootstrapSetupCodeIfRequired } from "./auth/bootstrapSetupCode";
import { processFilesForS3 as processFilesForS3WithPrisma } from "./fileProcessing";
import { startScheduledBackups } from "./backups/scheduler";
import {
  allowedOrigins,
  backendRoot,
  getBackendVersion,
  initializeUploadDir,
  isAllowedOrigin,
  MAX_IMPORT_ARCHIVE_ENTRIES,
  MAX_IMPORT_COLLECTIONS,
  MAX_IMPORT_DRAWING_BYTES,
  MAX_IMPORT_DRAWINGS,
  MAX_IMPORT_MANIFEST_BYTES,
  MAX_IMPORT_TOTAL_EXTRACTED_BYTES,
  MAX_PAGE_SIZE,
  MAX_UPLOAD_SIZE_BYTES,
  uploadDir,
} from "./server/appRuntime";
import { registerHttpMiddleware } from "./server/httpMiddleware";
import {
  collectionNameSchema,
  drawingCreateSchema,
  drawingUpdateSchema,
  removeFileIfExists,
  respondWithValidationErrors,
  verifyDatabaseIntegrityAsync,
} from "./server/routeValidation";
export { sanitizeDrawingUpdateData } from "./server/routeValidation";
const app = express();
const trustProxyConfig = (process.env.TRUST_PROXY ?? "false").trim();
const parsedProxyHops = Number.parseInt(trustProxyConfig, 10);
const trustProxyValue =
  trustProxyConfig === "true"
    ? true
    : trustProxyConfig === "false"
      ? false
      : Number.isFinite(parsedProxyHops) && parsedProxyHops > 0
        ? parsedProxyHops
        : false;
app.set("trust proxy", trustProxyValue);
if (trustProxyValue === true) {
  console.log("[config] trust proxy: enabled (handles multiple proxy layers)");
} else {
  console.log(`[config] trust proxy: ${trustProxyValue}`);
}
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
    credentials: true,
  },
  maxHttpBufferSize: 50 * 1024 * 1024,
});
const parseJsonField = <T>(
  rawValue: string | null | undefined,
  fallback: T,
): T => {
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    console.warn("Failed to parse JSON field", {
      error,
      valuePreview: rawValue.slice(0, 50),
    });
    return fallback;
  }
};
const DRAWINGS_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.DRAWINGS_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5_000;
  }
  return parsed;
})();
const {
  buildDrawingsCacheKey,
  getCachedDrawingsBody,
  cacheDrawingsResponse,
  invalidateDrawingsCache,
} = createDrawingsCacheStore(DRAWINGS_CACHE_TTL_MS);
const getUserTrashCollectionId = (userId: string): string => `trash:${userId}`;
const ensureTrashCollection = async (
  db: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<void> => {
  const trashCollectionId = getUserTrashCollectionId(userId);
  const trashCollection = await db.collection.findFirst({
    where: { id: trashCollectionId, userId },
  });
  if (!trashCollection) {
    await db.collection.create({
      data: { id: trashCollectionId, name: "Trash", userId },
    });
  }
  await db.drawing.updateMany({
    where: { userId, collectionId: "trash" },
    data: { collectionId: trashCollectionId },
  });
};
const PORT = config.port;
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "db") {
      const isSqliteDb =
        file.originalname.endsWith(".db") ||
        file.originalname.endsWith(".sqlite");
      if (!isSqliteDb) {
        return cb(new Error("Only .db or .sqlite files are allowed"));
      }
    }
    cb(null, true);
  },
});
registerHttpMiddleware({
  app,
  authRouter,
  allowedOrigins,
  isAllowedOrigin,
});
registerSocketHandlers({
  io,
  prisma,
  authModeService,
  jwtSecret: config.jwtSecret,
});
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error("Health check failed", error);
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});
const enableOnboardingGate =
  config.authMode === "local" &&
  config.nodeEnv === "production" &&
  process.env.DISABLE_ONBOARDING_GATE !== "true";
if (enableOnboardingGate) {
  const ONBOARDING_GATE_TTL_MS = 5_000;
  let onboardingGateCache: { required: boolean; fetchedAt: number } | null =
    null;
  const isOnboardingGateBypassPath = (reqPath: string): boolean => {
    if (reqPath === "/health") return true;
    if (reqPath === "/csrf-token") return true;
    if (reqPath === "/auth") return true;
    if (reqPath.startsWith("/auth/")) return true;
    return false;
  };
  const isAuthOnboardingRequired = async (): Promise<boolean> => {
    const now = Date.now();
    if (
      onboardingGateCache &&
      now - onboardingGateCache.fetchedAt < ONBOARDING_GATE_TTL_MS
    ) {
      return onboardingGateCache.required;
    }
    const systemConfig = await authModeService.ensureSystemConfig();
    if (systemConfig.authEnabled || systemConfig.authOnboardingCompleted) {
      onboardingGateCache = { required: false, fetchedAt: now };
      return false;
    }
    const hasActiveUser = await prisma.user.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    const required = !hasActiveUser;
    onboardingGateCache = { required, fetchedAt: now };
    return required;
  };
  app.use(async (req, res, next) => {
    try {
      if (isOnboardingGateBypassPath(req.path)) return next();
      const required = await isAuthOnboardingRequired();
      if (!required) return next();
      res.setHeader("Clear-Site-Data", '"cache"');
      return res
        .status(409)
        .json({
          error: "Authentication onboarding required",
          code: "AUTH_ONBOARDING_REQUIRED",
          message:
            "Authentication onboarding is required before using the app. Refresh the page to load the latest UI and complete setup.",
          redirectTo: "/auth-setup",
        });
    } catch (error) {
      console.error("Auth onboarding gate error:", error);
      return next();
    }
  });
}
registerSystemRoutes(app, { asyncHandler, getBackendVersion });
registerDashboardRoutes(app, {
  prisma,
  io,
  requireAuth,
  optionalAuth,
  asyncHandler,
  parseJsonField,
  sanitizeText,
  validateImportedDrawing,
  drawingCreateSchema,
  drawingUpdateSchema,
  respondWithValidationErrors,
  collectionNameSchema,
  ensureTrashCollection,
  invalidateDrawingsCache,
  buildDrawingsCacheKey,
  getCachedDrawingsBody,
  cacheDrawingsResponse,
  MAX_PAGE_SIZE,
  config,
  logAuditEvent,
  processFilesForS3: (files, userId, drawingId) =>
    processFilesForS3WithPrisma(files, userId, drawingId, prisma),
});
registerFileRoutes(app, { prisma, requireAuth, optionalAuth, asyncHandler });
registerStorageRoutes(app, {
  prisma,
  requireAuth,
  asyncHandler,
  parseJsonField,
  invalidateDrawingsCache,
  io,
});
registerImportExportRoutes({
  app,
  prisma,
  requireAuth,
  asyncHandler,
  upload,
  uploadDir,
  backendRoot,
  getBackendVersion,
  parseJsonField,
  sanitizeText,
  validateImportedDrawing,
  ensureTrashCollection,
  invalidateDrawingsCache,
  removeFileIfExists,
  verifyDatabaseIntegrityAsync,
  MAX_IMPORT_ARCHIVE_ENTRIES,
  MAX_IMPORT_COLLECTIONS,
  MAX_IMPORT_DRAWINGS,
  MAX_IMPORT_MANIFEST_BYTES,
  MAX_IMPORT_DRAWING_BYTES,
  MAX_IMPORT_TOTAL_EXTRACTED_BYTES,
});
app.use(errorHandler);
export { app, httpServer };
const isMain = typeof require !== "undefined" && require.main === module;
const SNAPSHOT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
setInterval(
  async () => {
    try {
      const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_MS);
      const result = await prisma.drawingSnapshot.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        console.log(`[Cleanup] Deleted ${result.count} old drawing snapshots`);
      }
    } catch (err) {
      console.error("[Cleanup] Snapshot cleanup failed:", err);
    }
  },
  60 * 60 * 1000,
);
if (isMain) {
  void (async () => {
    await configureSqlite();
    startScheduledBackups({
      prisma,
      databaseUrl: config.databaseUrl,
      schedule: config.backups.schedule,
      backupDir: config.backups.dir,
      retentionDays: config.backups.retentionDays,
    });
    httpServer.listen(PORT, async () => {
      await initializeUploadDir();
      try {
        await issueBootstrapSetupCodeIfRequired({
          prisma,
          ttlMs: config.bootstrapSetupCodeTtlMs,
          authMode: config.authMode,
          reason: "startup",
        });
      } catch (error) {
        console.error("Failed to issue bootstrap setup code:", error);
      }
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${config.nodeEnv}`);
      console.log(`Frontend URL: ${config.frontendUrl}`);
    });
  })();
}
