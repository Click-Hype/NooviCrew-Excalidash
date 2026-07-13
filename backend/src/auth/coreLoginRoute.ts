import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { logAuditEvent } from "../utils/audit";
import { loginSchema } from "./schemas";
import { hashTokenForStorage } from "./tokenSecurity";
import { canUseLocalPasswordFlows } from "./localPassword";
import type { RegisterCoreRoutesDeps } from "./coreRouteTypes";

export const registerLoginRoute = (deps: RegisterCoreRoutesDeps) => {
  const {
    router,
    prisma,
    loginAttemptRateLimiter,
    ensureAuthEnabled,
    findUserByIdentifier,
    requireCsrf,
    config,
    generateTokens,
    getRefreshTokenExpiresAt,
    isMissingRefreshTokenTableError,
    bootstrapUserId,
    setAuthCookies,
  } = deps;

  router.post(
    "/login",
    loginAttemptRateLimiter,
    async (req: Request, res: Response) => {
      try {
        if (!(await ensureAuthEnabled(res))) return;
        if (config.authMode === "oidc_enforced") {
          return res
            .status(403)
            .json({
              error: "Forbidden",
              message: "Local login is disabled in OIDC enforced mode",
            });
        }
        if (!requireCsrf(req, res)) return;
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({
              error: "Validation error",
              message: "Invalid login credentials",
            });
        }
        const identifier =
          parsed.data.email ||
          parsed.data.username ||
          parsed.data.identifier ||
          "";
        const { password } = parsed.data;
        const bootstrapUser = await prisma.user.findUnique({
          where: { id: bootstrapUserId },
          select: { id: true, isActive: true },
        });
        if (bootstrapUser && bootstrapUser.isActive === false) {
          const activeUsers = await prisma.user.count({
            where: { isActive: true },
          });
          if (activeUsers === 0) {
            return res
              .status(409)
              .json({
                error: "Bootstrap required",
                message:
                  "Initial admin account has not been configured yet. Register to bootstrap.",
              });
          }
        }
        const user = await findUserByIdentifier(identifier);
        if (!user) {
          return res
            .status(401)
            .json({
              error: "Unauthorized",
              message: "Invalid email or password",
            });
        }
        if (!user.isActive) {
          return res
            .status(401)
            .json({
              error: "Unauthorized",
              message: "Invalid email or password",
            });
        }
        if (!canUseLocalPasswordFlows(user)) {
          return res
            .status(401)
            .json({
              error: "Unauthorized",
              message: "Invalid email or password",
            });
        }
        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) {
          if (config.enableAuditLogging) {
            await logAuditEvent({
              action: "login_failed",
              ipAddress: req.ip || req.connection.remoteAddress || undefined,
              userAgent: req.headers["user-agent"] || undefined,
              details: { identifier },
            });
          }
          return res
            .status(401)
            .json({
              error: "Unauthorized",
              message: "Invalid email or password",
            });
        }
        const { accessToken, refreshToken } = generateTokens(
          user.id,
          user.email,
        );
        setAuthCookies(req, res, { accessToken, refreshToken });
        if (config.enableRefreshTokenRotation) {
          const expiresAt = getRefreshTokenExpiresAt();
          try {
            await prisma.refreshToken.create({
              data: {
                userId: user.id,
                token: hashTokenForStorage(refreshToken),
                expiresAt,
              },
            });
          } catch (error) {
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
            }
            throw error;
          }
        }
        if (config.enableAuditLogging) {
          await logAuditEvent({
            userId: user.id,
            action: "login",
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
            userAgent: req.headers["user-agent"] || undefined,
          });
        }
        res.json({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            mustResetPassword: user.mustResetPassword,
          },
        });
      } catch (error) {
        console.error("Login error:", error);
        res
          .status(500)
          .json({ error: "Internal server error", message: "Failed to login" });
      }
    },
  );
};
