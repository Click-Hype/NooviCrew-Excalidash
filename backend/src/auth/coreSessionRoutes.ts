import { Request, Response } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { StringValue } from "ms";
import { getTokenLookupCandidates, hashTokenForStorage } from "./tokenSecurity";
import type { RegisterCoreRoutesDeps } from "./coreRouteTypes";

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const registerSessionRoutes = (deps: RegisterCoreRoutesDeps) => {
  const {
    router,
    prisma,
    requireAuth,
    optionalAuth,
    ensureAuthEnabled,
    requireCsrf,
    isJwtPayload,
    config,
    generateTokens,
    getRefreshTokenExpiresAt,
    isMissingRefreshTokenTableError,
    setAuthCookies,
    setAccessTokenCookie,
    clearAuthCookies,
    readRefreshTokenFromRequest,
  } = deps;

  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      if (!(await ensureAuthEnabled(res))) return;
      if (!requireCsrf(req, res)) return;
      const oldRefreshToken = readRefreshTokenFromRequest(req);
      if (!oldRefreshToken || typeof oldRefreshToken !== "string") {
        return res
          .status(401)
          .json({ error: "Unauthorized", message: "Refresh token required" });
      }
      try {
        const decoded = jwt.verify(oldRefreshToken, config.jwtSecret);
        if (!isJwtPayload(decoded)) {
          return res
            .status(401)
            .json({ error: "Unauthorized", message: "Invalid token payload" });
        }
        if (decoded.type !== "refresh") {
          return res
            .status(401)
            .json({ error: "Unauthorized", message: "Invalid token type" });
        }
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, isActive: true },
        });
        if (!user || !user.isActive) {
          return res
            .status(401)
            .json({
              error: "Unauthorized",
              message: "User account not found or inactive",
            });
        }
        if (decoded.impersonatorId) {
          const impersonator = await prisma.user.findUnique({
            where: { id: decoded.impersonatorId },
            select: { id: true, role: true, isActive: true },
          });
          if (
            !impersonator ||
            !impersonator.isActive ||
            impersonator.role !== "ADMIN"
          ) {
            return res.status(401).json({
              error: "Unauthorized",
              message: "Impersonation session is no longer authorized",
            });
          }
        }
        if (config.enableRefreshTokenRotation) {
          try {
            const { accessToken, refreshToken: newRefreshToken } =
              generateTokens(user.id, user.email, {
                impersonatorId: decoded.impersonatorId,
                authProvider: decoded.authProvider,
                oidcGroups: decoded.oidcGroups,
              });
            const expiresAt = getRefreshTokenExpiresAt();
            await prisma.$transaction(async (tx) => {
              const storedToken = await tx.refreshToken.findFirst({
                where: {
                  OR: getTokenLookupCandidates(oldRefreshToken).map(
                    (candidate) => ({ token: candidate }),
                  ),
                },
              });
              if (
                !storedToken ||
                storedToken.userId !== user.id ||
                storedToken.revoked
              ) {
                throw new HttpError(401, "Invalid or revoked refresh token");
              }
              if (new Date() > storedToken.expiresAt) {
                throw new HttpError(401, "Refresh token has expired");
              }
              const revoked = await tx.refreshToken.updateMany({
                where: { id: storedToken.id, revoked: false },
                data: { revoked: true },
              });
              if (revoked.count !== 1) {
                throw new HttpError(401, "Invalid or revoked refresh token");
              }
              await tx.refreshToken.create({
                data: {
                  userId: user.id,
                  token: hashTokenForStorage(newRefreshToken),
                  expiresAt,
                },
              });
            });
            setAuthCookies(req, res, {
              accessToken,
              refreshToken: newRefreshToken,
            });
            return res.json({ ok: true });
          } catch (error) {
            if (error instanceof HttpError) {
              return res
                .status(error.statusCode)
                .json({ error: "Unauthorized", message: error.message });
            }
            if (isMissingRefreshTokenTableError(error)) {
              console.error(
                "Refresh token rotation is enabled but refresh token storage is unavailable",
              );
              return res
                .status(503)
                .json({
                  error: "Service unavailable",
                  message:
                    "Refresh token storage is unavailable. Please run database migrations.",
                });
            } else {
              console.error("Refresh token rotation error:", error);
              return res
                .status(500)
                .json({
                  error: "Internal server error",
                  message: "Failed to rotate refresh token",
                });
            }
          }
        }
        const signOptions: SignOptions = {
          expiresIn: config.jwtAccessExpiresIn as StringValue,
        };
        const accessToken = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            type: "access",
            impersonatorId: decoded.impersonatorId,
            authProvider: decoded.authProvider,
            oidcGroups: decoded.oidcGroups,
          },
          config.jwtSecret,
          signOptions,
        );
        setAccessTokenCookie(req, res, accessToken);
        res.json({ ok: true });
      } catch {
        return res
          .status(401)
          .json({
            error: "Unauthorized",
            message: "Invalid or expired refresh token",
          });
      }
    } catch (error) {
      console.error("Refresh token error:", error);
      res
        .status(500)
        .json({
          error: "Internal server error",
          message: "Failed to refresh token",
        });
    }
  });
  router.post("/logout", optionalAuth, async (req: Request, res: Response) => {
    try {
      if (!(await ensureAuthEnabled(res))) return;
      if (!requireCsrf(req, res)) return;
      const currentRefreshToken = readRefreshTokenFromRequest(req);
      clearAuthCookies(req, res);
      if (config.enableRefreshTokenRotation && currentRefreshToken) {
        await prisma.refreshToken.updateMany({
          where: {
            OR: getTokenLookupCandidates(currentRefreshToken).map(
              (candidate) => ({ token: candidate }),
            ),
            revoked: false,
          },
          data: { revoked: true },
        });
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error("Logout error:", error);
      return res
        .status(500)
        .json({ error: "Internal server error", message: "Failed to logout" });
    }
  });
  router.post(
    "/stop-impersonation",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        if (!(await ensureAuthEnabled(res))) return;
        if (!requireCsrf(req, res)) return;
        if (!req.user) {
          return res
            .status(401)
            .json({ error: "Unauthorized", message: "User not authenticated" });
        }
        if (!req.user.impersonatorId) {
          return res
            .status(409)
            .json({
              error: "Conflict",
              message: "Not currently impersonating another user",
            });
        }
        const impersonator = await prisma.user.findUnique({
          where: { id: req.user.impersonatorId },
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
        if (
          !impersonator ||
          !impersonator.isActive ||
          impersonator.role !== "ADMIN"
        ) {
          return res
            .status(403)
            .json({
              error: "Forbidden",
              message:
                "Impersonator account is unavailable or no longer authorized",
            });
        }
        const { accessToken, refreshToken } = generateTokens(
          impersonator.id,
          impersonator.email,
        );
        if (config.enableRefreshTokenRotation) {
          const expiresAt = getRefreshTokenExpiresAt();
          try {
            const currentRefreshToken = readRefreshTokenFromRequest(req);
            await prisma.$transaction(async (tx) => {
              if (currentRefreshToken) {
                await tx.refreshToken.updateMany({
                  where: {
                    OR: getTokenLookupCandidates(currentRefreshToken).map(
                      (candidate) => ({ token: candidate }),
                    ),
                    revoked: false,
                  },
                  data: { revoked: true },
                });
              }
              await tx.refreshToken.create({
                data: {
                  userId: impersonator.id,
                  token: hashTokenForStorage(refreshToken),
                  expiresAt,
                },
              });
            });
          } catch (error) {
            if (isMissingRefreshTokenTableError(error)) {
              return res
                .status(503)
                .json({
                  error: "Service unavailable",
                  message:
                    "Refresh token storage is unavailable. Please run database migrations.",
                });
            }
            throw error;
          }
        }
        setAuthCookies(req, res, { accessToken, refreshToken });
        return res.json({
          user: {
            id: impersonator.id,
            username: impersonator.username,
            email: impersonator.email,
            name: impersonator.name,
            role: impersonator.role,
            mustResetPassword: impersonator.mustResetPassword,
          },
        });
      } catch (error) {
        console.error("Stop impersonation error:", error);
        return res
          .status(500)
          .json({
            error: "Internal server error",
            message: "Failed to stop impersonation",
          });
      }
    },
  );
};
