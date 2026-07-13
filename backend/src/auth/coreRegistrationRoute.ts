import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { Prisma } from "../generated/client";
import { logAuditEvent } from "../utils/audit";
import { registerSchema } from "./schemas";
import { hashTokenForStorage } from "./tokenSecurity";
import {
  issueBootstrapSetupCodeIfRequired,
  verifyBootstrapSetupCode,
} from "./bootstrapSetupCode";
import type { RegisterCoreRoutesDeps } from "./coreRouteTypes";

export const registerRegistrationRoute = (deps: RegisterCoreRoutesDeps) => {
  const {
    router,
    prisma,
    loginAttemptRateLimiter,
    ensureAuthEnabled,
    ensureSystemConfig,
    sanitizeText,
    requireCsrf,
    config,
    generateTokens,
    getRefreshTokenExpiresAt,
    isMissingRefreshTokenTableError,
    bootstrapUserId,
    setAuthCookies,
  } = deps;
  const getUserTrashCollectionId = (userId: string): string =>
    `trash:${userId}`;

  router.post(
    "/register",
    loginAttemptRateLimiter,
    async (req: Request, res: Response) => {
      try {
        if (!(await ensureAuthEnabled(res))) return;
        if (config.authMode === "oidc_enforced") {
          return res
            .status(403)
            .json({
              error: "Forbidden",
              message: "Local registration is disabled in OIDC enforced mode",
            });
        }
        if (!requireCsrf(req, res)) return;
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
          const flattened = parsed.error.flatten();
          const fieldMessages = Object.values(flattened.fieldErrors).flatMap(
            (messages) => messages ?? [],
          );
          const formMessages = flattened.formErrors ?? [];
          const messages = [...formMessages, ...fieldMessages].filter(
            (message): message is string =>
              typeof message === "string" && message.trim().length > 0,
          );
          return res
            .status(400)
            .json({
              error: "Validation error",
              message: messages[0] || "Invalid registration data",
              details: {
                formErrors: flattened.formErrors,
                fieldErrors: flattened.fieldErrors,
              },
            });
        }
        const { email, password, name, username, setupCode } = parsed.data;
        const systemConfig = await ensureSystemConfig();
        const activeUsers = await prisma.user.count({
          where: { isActive: true },
        });
        const bootstrapUser = await prisma.user.findUnique({
          where: { id: bootstrapUserId },
          select: { id: true, isActive: true },
        });
        const isBootstrapFlow =
          Boolean(bootstrapUser) &&
          bootstrapUser?.isActive === false &&
          activeUsers === 0 &&
          bootstrapUser.id === bootstrapUserId;
        if (isBootstrapFlow) {
          const setupCodeVerification = await verifyBootstrapSetupCode({
            prisma,
            providedCode: setupCode,
            maxAttempts: Math.max(
              1,
              Math.floor(config.bootstrapSetupCodeMaxAttempts),
            ),
          });
          if (!setupCodeVerification.ok) {
            const reason = (
              setupCodeVerification as { ok: false; reason: string }
            ).reason;
            if (
              reason === "unavailable" ||
              reason === "expired" ||
              reason === "locked"
            ) {
              await issueBootstrapSetupCodeIfRequired({
                prisma,
                ttlMs: config.bootstrapSetupCodeTtlMs,
                authMode: config.authMode,
                reason: "bootstrap_register_reissue",
              });
            }
            if (reason === "missing") {
              return res
                .status(400)
                .json({
                  error: "Bad request",
                  message:
                    "Bootstrap setup code is required for first admin registration",
                });
            }
            if (reason === "invalid") {
              return res
                .status(401)
                .json({
                  error: "Unauthorized",
                  message: "Invalid bootstrap setup code",
                });
            }
            if (reason === "locked") {
              return res
                .status(429)
                .json({
                  error: "Too many requests",
                  message:
                    "Too many invalid setup code attempts. A new setup code has been issued in backend logs.",
                });
            }
            return res
              .status(409)
              .json({
                error: "Conflict",
                message:
                  "Bootstrap setup code is unavailable or expired. A new setup code has been issued in backend logs.",
              });
          }
          const saltRounds = 10;
          const passwordHash = await bcrypt.hash(password, saltRounds);
          const sanitizedName = sanitizeText(name, 100);
          const existingEmailUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
          });
          if (existingEmailUser && existingEmailUser.id !== bootstrapUserId) {
            return res
              .status(409)
              .json({
                error: "Conflict",
                message: "User with this email already exists",
              });
          }
          if (username) {
            const existingUsernameUser = await prisma.user.findFirst({
              where: { username },
              select: { id: true },
            });
            if (
              existingUsernameUser &&
              existingUsernameUser.id !== bootstrapUserId
            ) {
              return res.status(409).json({
                error: "Conflict",
                message: "User with this username already exists",
              });
            }
          }
          let user: {
            id: string;
            email: string;
            name: string;
            role: string;
            mustResetPassword: boolean;
          };
          try {
            user = await prisma.user.update({
              where: { id: bootstrapUserId },
              data: {
                email,
                username: username ?? null,
                passwordHash,
                name: sanitizedName,
                role: "ADMIN",
                mustResetPassword: false,
                isActive: true,
              },
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                mustResetPassword: true,
              },
            });
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              return res
                .status(409)
                .json({
                  error: "Conflict",
                  message: "User with this email or username already exists",
                });
            }
            throw error;
          }
          const trashCollectionId = getUserTrashCollectionId(user.id);
          const existingTrash = await prisma.collection.findFirst({
            where: { id: trashCollectionId, userId: user.id },
          });
          if (!existingTrash) {
            await prisma.collection.create({
              data: { id: trashCollectionId, name: "Trash", userId: user.id },
            });
          }
          const { accessToken, refreshToken } = generateTokens(
            user.id,
            user.email,
          );
          setAuthCookies(req, res, { accessToken, refreshToken });
          if (config.enableRefreshTokenRotation) {
            const expiresAt = getRefreshTokenExpiresAt();
            await prisma.refreshToken.create({
              data: {
                userId: user.id,
                token: hashTokenForStorage(refreshToken),
                expiresAt,
              },
            });
          }
          if (config.enableAuditLogging) {
            await logAuditEvent({
              userId: user.id,
              action: "bootstrap_admin",
              ipAddress: req.ip || req.connection.remoteAddress || undefined,
              userAgent: req.headers["user-agent"] || undefined,
            });
          }
          return res
            .status(201)
            .json({
              user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                mustResetPassword: user.mustResetPassword,
              },
              registrationEnabled: systemConfig.registrationEnabled,
              bootstrapped: true,
            });
        }
        if (!systemConfig.registrationEnabled) {
          return res
            .status(403)
            .json({
              error: "Forbidden",
              message: "User registration is disabled.",
            });
        }
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
          return res
            .status(409)
            .json({
              error: "Conflict",
              message: "User with this email already exists",
            });
        }
        if (username) {
          const existingUsername = await prisma.user.findFirst({
            where: { username },
            select: { id: true },
          });
          if (existingUsername) {
            return res
              .status(409)
              .json({
                error: "Conflict",
                message: "User with this username already exists",
              });
          }
        }
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const sanitizedName = sanitizeText(name, 100);
        const user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            name: sanitizedName,
            username: username ?? null,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            mustResetPassword: true,
            createdAt: true,
          },
        });
        const trashCollectionId = getUserTrashCollectionId(user.id);
        const existingTrash = await prisma.collection.findFirst({
          where: { id: trashCollectionId, userId: user.id },
        });
        if (!existingTrash) {
          await prisma.collection.create({
            data: { id: trashCollectionId, name: "Trash", userId: user.id },
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
            action: "user_registered",
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
            userAgent: req.headers["user-agent"] || undefined,
          });
        }
        res
          .status(201)
          .json({
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              mustResetPassword: user.mustResetPassword,
            },
            registrationEnabled: systemConfig.registrationEnabled,
          });
      } catch (error) {
        console.error("Registration error:", error);
        res
          .status(500)
          .json({
            error: "Internal server error",
            message: "Failed to register user",
          });
      }
    },
  );
};
