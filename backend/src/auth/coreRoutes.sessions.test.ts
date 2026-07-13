import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerCoreRoutes } from "./coreRoutes";
import { getTokenLookupCandidates } from "./tokenSecurity";

const JWT_SECRET = "test-session-secret";

const buildApp = (options?: {
  refreshToken?: string;
  userFindUnique?: (args: any) => Promise<any>;
}) => {
  const router = express.Router();
  const app = express();
  app.use(express.json());
  const prisma = {
    user: {
      findUnique: vi.fn(
        options?.userFindUnique ??
          (async () => ({
            id: "user-1",
            email: "user@example.com",
            isActive: true,
          })),
      ),
    },
    refreshToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  registerCoreRoutes({
    router,
    prisma: prisma as any,
    requireAuth: ((req: any, _res: any, next: any) => {
      req.user = {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        role: "USER",
        impersonatorId: "admin-1",
      };
      next();
    }) as any,
    optionalAuth: ((_req: any, _res: any, next: any) => next()) as any,
    loginAttemptRateLimiter: ((_req: any, _res: any, next: any) => next()) as any,
    ensureAuthEnabled: vi.fn().mockResolvedValue(true),
    ensureSystemConfig: vi.fn().mockResolvedValue({
      id: "default",
      authEnabled: true,
      authOnboardingCompleted: true,
      registrationEnabled: false,
      oidcJitProvisioningEnabled: null,
    }),
    findUserByIdentifier: vi.fn(),
    sanitizeText: (value: unknown) => String(value ?? ""),
    requireCsrf: () => true,
    isJwtPayload: (decoded: unknown): decoded is any =>
      typeof decoded === "object" && decoded !== null,
    config: {
      authMode: "local",
      jwtSecret: JWT_SECRET,
      jwtAccessExpiresIn: "15m",
      enableRefreshTokenRotation: true,
      enableAuditLogging: false,
      oidc: {
        enabled: false,
        enforced: false,
        providerName: "OIDC",
        jitProvisioning: false,
      },
      bootstrapSetupCodeTtlMs: 900_000,
      bootstrapSetupCodeMaxAttempts: 10,
      passwordPolicy: {
        minLength: 8,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSymbol: true,
      },
    },
    generateTokens: vi.fn().mockReturnValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    }),
    getRefreshTokenExpiresAt: () => new Date(Date.now() + 86_400_000),
    isMissingRefreshTokenTableError: () => false,
    bootstrapUserId: "bootstrap-admin",
    defaultSystemConfigId: "default",
    clearAuthEnabledCache: vi.fn(),
    setAuthCookies: vi.fn(),
    setAccessTokenCookie: vi.fn(),
    clearAuthCookies: vi.fn(),
    readRefreshTokenFromRequest: () => options?.refreshToken ?? null,
  });
  app.use(router);
  return { app, prisma };
};

describe("core session revocation", () => {
  it("logout revokes the presented refresh token without revoking every session", async () => {
    const refreshToken = "presented-refresh-token";
    const { app, prisma } = buildApp({ refreshToken });

    const response = await request(app).post("/logout");

    expect(response.status).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        OR: getTokenLookupCandidates(refreshToken).map((token) => ({ token })),
        revoked: false,
      },
      data: { revoked: true },
    });
  });

  it("rejects refresh of impersonation after the admin loses authorization", async () => {
    const refreshToken = jwt.sign(
      {
        userId: "user-1",
        email: "user@example.com",
        type: "refresh",
        impersonatorId: "admin-1",
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    const { app, prisma } = buildApp({
      refreshToken,
      userFindUnique: async ({ where }: any) =>
        where.id === "user-1"
          ? { id: "user-1", email: "user@example.com", isActive: true }
          : { id: "admin-1", role: "USER", isActive: true },
    });

    const response = await request(app).post("/refresh");

    expect(response.status).toBe(401);
    expect(response.body?.message).toContain("no longer authorized");
    expect(prisma.refreshToken.findFirst).not.toHaveBeenCalled();
  });
});
