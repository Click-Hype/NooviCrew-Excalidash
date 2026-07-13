import express, { Request, Response } from "express";
import { PrismaClient } from "../generated/client";

export type RegisterCoreRoutesDeps = {
  router: express.Router;
  prisma: PrismaClient;
  requireAuth: express.RequestHandler;
  optionalAuth: express.RequestHandler;
  loginAttemptRateLimiter: express.RequestHandler;
  ensureAuthEnabled: (res: Response) => Promise<boolean>;
  ensureSystemConfig: () => Promise<{
    id: string;
    authEnabled: boolean;
    authOnboardingCompleted: boolean;
    registrationEnabled: boolean;
    oidcJitProvisioningEnabled: boolean | null;
  }>;
  findUserByIdentifier: (
    identifier: string,
  ) => Promise<{
    id: string;
    username: string | null;
    email: string;
    passwordHash: string;
    name: string;
    role: string;
    isActive: boolean;
    mustResetPassword: boolean;
  } | null>;
  sanitizeText: (input: unknown, maxLength?: number) => string;
  requireCsrf: (req: Request, res: Response) => boolean;
  isJwtPayload: (
    decoded: unknown,
  ) => decoded is {
    userId: string;
    email: string;
    type: "access" | "refresh";
    impersonatorId?: string;
    authProvider?: "local" | "oidc";
    oidcGroups?: string[];
  };
  config: {
    authMode: "local" | "hybrid" | "oidc_enforced";
    jwtSecret: string;
    jwtAccessExpiresIn: string;
    enableRefreshTokenRotation: boolean;
    enableAuditLogging: boolean;
    oidc: {
      enabled: boolean;
      enforced: boolean;
      providerName: string;
      jitProvisioning: boolean;
    };
    bootstrapSetupCodeTtlMs: number;
    bootstrapSetupCodeMaxAttempts: number;
    passwordPolicy: {
      minLength: number;
      maxLength: number;
      requireUppercase: boolean;
      requireLowercase: boolean;
      requireNumber: boolean;
      requireSymbol: boolean;
    };
  };
  generateTokens: (
    userId: string,
    email: string,
    options?: {
      impersonatorId?: string;
      authProvider?: "local" | "oidc";
      oidcGroups?: string[];
    },
  ) => { accessToken: string; refreshToken: string };
  getRefreshTokenExpiresAt: () => Date;
  isMissingRefreshTokenTableError: (error: unknown) => boolean;
  bootstrapUserId: string;
  defaultSystemConfigId: string;
  clearAuthEnabledCache: () => void;
  setAuthCookies: (
    req: Request,
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) => void;
  setAccessTokenCookie: (
    req: Request,
    res: Response,
    accessToken: string,
  ) => void;
  clearAuthCookies: (req: Request, res: Response) => void;
  readRefreshTokenFromRequest: (req: Request) => string | null;
};
