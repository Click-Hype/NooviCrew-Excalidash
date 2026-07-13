import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { PrismaClient } from "../generated/client";
import { prisma as defaultPrisma } from "../db/prisma";
import { createAuthModeService, type AuthModeService } from "../auth/authMode";
import {
  apiKeyHashMatches,
  extractApiKeyId,
  isApiKeyToken,
  parseApiKeyScopes,
} from "../auth/apiKeys";
import {
  authorizeApiKeyRequest,
  getRequiredApiKeyScope,
  isAllowedWhileMustResetPassword,
  isApiKeySelfIdentityRoute,
} from "./authRequestPolicy";
import {
  extractAuthToken,
  hasRefreshTokenCookie,
  type JwtPayload,
  verifyAccessToken,
} from "./authToken";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username?: string | null;
        email: string;
        name: string;
        role: string;
        mustResetPassword?: boolean;
        impersonatorId?: string;
        authCredentialType?: "jwt" | "apiKey" | "bootstrap";
      };
      principal?: { kind: "user"; userId: string };
      authError?: { code: "INVALID_ACCESS_TOKEN" | "ACCESS_TOKEN_MISSING" };
    }
  }
}

export type AuthMiddlewareDeps = {
  prisma: PrismaClient;
  authModeService: AuthModeService;
};

export const createAuthMiddleware = ({
  prisma,
  authModeService,
}: AuthMiddlewareDeps) => {
  const configuredOidcAdminGroups = new Set(config.oidc.adminGroups);
  const findActiveUser = (userId: string) =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        mustResetPassword: true,
        isActive: true,
      },
    });

  const attachUser = (
    req: Request,
    user: {
      id: string;
      username?: string | null;
      email: string;
      name: string;
      role: string;
      mustResetPassword?: boolean;
    },
    credentialType: "jwt" | "apiKey" | "bootstrap",
    impersonatorId?: string,
  ) => {
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
      impersonatorId,
      authCredentialType: credentialType,
    };
    req.principal = { kind: "user", userId: user.id };
  };

  const authenticateApiKey = async (token: string) => {
    const keyId = extractApiKeyId(token);
    if (!keyId) return null;
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyId },
      include: { user: true },
    });
    if (
      !apiKey ||
      apiKey.revokedAt ||
      !apiKeyHashMatches(token, apiKey.tokenHash) ||
      !apiKey.user.isActive
    ) {
      return null;
    }
    try {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      console.warn("Failed to update API key lastUsedAt:", error);
    }
    return { user: apiKey.user, scopes: parseApiKeyScopes(apiKey.scopes) };
  };

  const shouldReconcileOidcRole = async (
    payload: JwtPayload,
    userId: string,
  ): Promise<boolean> => {
    if (configuredOidcAdminGroups.size === 0 || payload.impersonatorId) {
      return false;
    }
    if (payload.authProvider === "oidc") return true;
    if (payload.authProvider === "local") return false;
    const identity = await prisma.authIdentity.findUnique({
      where: { provider_userId: { provider: "oidc", userId } },
      select: { id: true },
    });
    return Boolean(identity);
  };

  const reconcileRoleFromOidcGroups = async (
    payload: JwtPayload,
    user: NonNullable<Awaited<ReturnType<typeof findActiveUser>>>,
  ) => {
    if (!(await shouldReconcileOidcRole(payload, user.id))) return user;
    const groups = Array.from(
      new Set(
        (payload.oidcGroups ?? [])
          .map((group) => group.trim())
          .filter(Boolean),
      ),
    );
    const expectedRole = groups.some((group) =>
      configuredOidcAdminGroups.has(group),
    )
      ? "ADMIN"
      : "USER";
    if (user.role === expectedRole) return user;
    return prisma.user.update({
      where: { id: user.id },
      data: { role: expectedRole },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        mustResetPassword: true,
        isActive: true,
      },
    });
  };

  const attachBootstrapUser = async (req: Request): Promise<boolean> => {
    if (await authModeService.getAuthEnabled()) return false;
    const user = await authModeService.getBootstrapActingUser();
    attachUser(req, user, "bootstrap");
    return true;
  };

  const requireAuth = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (await attachBootstrapUser(req)) return next();
    } catch (error) {
      console.error("Error reading auth mode:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to read authentication mode",
      });
      return;
    }

    const extracted = extractAuthToken(req);
    if (!extracted) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication token required",
      });
      return;
    }
    if (extracted.source === "bearer" && isApiKeyToken(extracted.token)) {
      try {
        const result = await authenticateApiKey(extracted.token);
        if (!result) {
          res.status(401).json({
            error: "Unauthorized",
            message: "Invalid or revoked API key",
          });
          return;
        }
        if (!authorizeApiKeyRequest(req, res, result.scopes)) return;
        if (
          result.user.mustResetPassword &&
          !isAllowedWhileMustResetPassword(req)
        ) {
          res.status(403).json({
            error: "Forbidden",
            code: "MUST_RESET_PASSWORD",
            message: "You must reset your password before using the app",
          });
          return;
        }
        attachUser(req, result.user, "apiKey");
        return next();
      } catch (error) {
        console.error("Error verifying API key:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to verify API key",
        });
        return;
      }
    }

    const payload = verifyAccessToken(extracted.token);
    if (!payload) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or expired token",
      });
      return;
    }
    try {
      const user = await findActiveUser(payload.userId);
      if (!user?.isActive) {
        res.status(401).json({
          error: "Unauthorized",
          message: "User account not found or inactive",
        });
        return;
      }
      const resolvedUser = await reconcileRoleFromOidcGroups(payload, user);
      if (
        resolvedUser.mustResetPassword &&
        !isAllowedWhileMustResetPassword(req)
      ) {
        res.status(403).json({
          error: "Forbidden",
          code: "MUST_RESET_PASSWORD",
          message: "You must reset your password before using the app",
        });
        return;
      }
      attachUser(req, resolvedUser, "jwt", payload.impersonatorId);
      next();
    } catch (error) {
      console.error("Error verifying user:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to verify user",
      });
    }
  };

  const optionalAuth = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (await attachBootstrapUser(req)) return next();
    } catch (error) {
      console.error("Error reading auth mode:", error);
      return next();
    }
    const extracted = extractAuthToken(req);
    if (!extracted) {
      if (hasRefreshTokenCookie(req)) {
        req.authError = { code: "ACCESS_TOKEN_MISSING" };
      }
      return next();
    }
    if (extracted.source === "bearer" && isApiKeyToken(extracted.token)) {
      try {
        const result = await authenticateApiKey(extracted.token);
        const requiredScope = getRequiredApiKeyScope(req);
        if (
          !result ||
          (!isApiKeySelfIdentityRoute(req) &&
            (!requiredScope || !result.scopes.includes(requiredScope)))
        ) {
          req.authError = { code: "INVALID_ACCESS_TOKEN" };
          return next();
        }
        attachUser(req, result.user, "apiKey");
      } catch (error) {
        console.error("Error in optional API key auth:", error);
        req.authError = { code: "INVALID_ACCESS_TOKEN" };
      }
      return next();
    }
    const payload = verifyAccessToken(extracted.token);
    if (!payload) {
      req.authError = { code: "INVALID_ACCESS_TOKEN" };
      return next();
    }
    try {
      const user = await findActiveUser(payload.userId);
      if (user?.isActive) attachUser(req, user, "jwt", payload.impersonatorId);
    } catch (error) {
      console.error("Error in optional auth:", error);
    }
    next();
  };

  return { requireAuth, optionalAuth };
};

const defaultAuthModeService = createAuthModeService(defaultPrisma);
const defaultAuthMiddleware = createAuthMiddleware({
  prisma: defaultPrisma,
  authModeService: defaultAuthModeService,
});
export const authModeService = defaultAuthModeService;
export const requireAuth = defaultAuthMiddleware.requireAuth;
export const optionalAuth = defaultAuthMiddleware.optionalAuth;
