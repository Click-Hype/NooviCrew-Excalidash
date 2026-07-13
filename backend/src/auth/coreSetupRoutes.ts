import { Request, Response } from "express";
import {
  authEnabledToggleSchema,
  authOnboardingChoiceSchema,
} from "./schemas";
import {
  issueBootstrapSetupCodeIfRequired,
  verifyBootstrapSetupCode,
} from "./bootstrapSetupCode";
import { getEffectiveOidcJitProvisioning } from "./accessPolicy";
import {
  buildAuthStatusPayload,
  ensureBootstrapUserExists,
  getAuthOnboardingStatus,
  getBootstrapRequired,
  upsertAuthModeState,
} from "./coreRouteHelpers";
import type { RegisterCoreRoutesDeps } from "./coreRouteTypes";

export const registerSetupRoutes = (deps: RegisterCoreRoutesDeps) => {
  const {
    router,
    prisma,
    requireAuth,
    optionalAuth,
    ensureAuthEnabled,
    ensureSystemConfig,
    requireCsrf,
    config,
    bootstrapUserId,
    defaultSystemConfigId,
    clearAuthEnabledCache,
  } = deps;

  router.get("/me", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await ensureAuthEnabled(res))) return;
      if (!req.user) {
        return res
          .status(401)
          .json({ error: "Unauthorized", message: "User not authenticated" });
      }
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          mustResetPassword: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!user) {
        return res
          .status(404)
          .json({ error: "Not found", message: "User not found" });
      }
      res.json({ user });
    } catch (error) {
      console.error("Get user error:", error);
      res
        .status(500)
        .json({
          error: "Internal server error",
          message: "Failed to get user information",
        });
    }
  });
  router.get("/status", optionalAuth, async (req: Request, res: Response) => {
    try {
      const systemConfig = await ensureSystemConfig();
      const onboarding = await getAuthOnboardingStatus(prisma, systemConfig);
      const effectiveAuthEnabled =
        config.authMode !== "local" ? true : systemConfig.authEnabled;
      const oidcJitProvisioningEnabled = getEffectiveOidcJitProvisioning(
        {
          oidcEnabled: config.oidc.enabled,
          defaultJitProvisioningEnabled: config.oidc.jitProvisioning,
        },
        systemConfig,
      );
      const bootstrapUser = await prisma.user.findUnique({
        where: { id: bootstrapUserId },
        select: { id: true, isActive: true },
      });
      res.json(
        buildAuthStatusPayload({
          authMode: config.authMode,
          oidc: {
            enabled: config.oidc.enabled,
            enforced: config.oidc.enforced,
            providerName: config.oidc.providerName,
          },
          systemConfig,
          effectiveAuthEnabled,
          oidcJitProvisioningEnabled,
          onboarding,
          bootstrapRequired: getBootstrapRequired({
            authEnabled: effectiveAuthEnabled,
            oidcEnforced: config.oidc.enforced,
            bootstrapUser,
            activeUsers: onboarding.activeUsers,
          }),
          passwordPolicy: config.passwordPolicy,
          user: req.user,
        }),
      );
    } catch (error) {
      console.error("Auth status error:", error);
      res
        .status(500)
        .json({
          error: "Internal server error",
          message: "Failed to fetch auth status",
        });
    }
  });
  router.post(
    "/onboarding-choice",
    optionalAuth,
    async (req: Request, res: Response) => {
      try {
        if (config.authMode !== "local") {
          return res
            .status(409)
            .json({
              error: "Conflict",
              message:
                "Onboarding choice is managed by AUTH_MODE configuration",
            });
        }
        if (!requireCsrf(req, res)) return;
        const parsed = authOnboardingChoiceSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({
              error: "Bad request",
              message: "Invalid onboarding choice payload",
            });
        }
        const systemConfig = await ensureSystemConfig();
        const onboarding = await getAuthOnboardingStatus(prisma, systemConfig);
        if (!onboarding.needsChoice) {
          return res.status(409).json({
            error: "Conflict",
            message: "Authentication onboarding is already completed",
          });
        }
        const setupCodeVerification = await verifyBootstrapSetupCode({
          prisma,
          providedCode: parsed.data.setupCode,
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
              reason: "onboarding_choice_reissue",
            });
          }
          if (reason === "missing") {
            return res.status(400).json({
              error: "Bad request",
              message: "Bootstrap setup code is required for onboarding",
            });
          }
          if (reason === "invalid") {
            return res.status(401).json({
              error: "Unauthorized",
              message: "Invalid bootstrap setup code",
            });
          }
          if (reason === "locked") {
            return res.status(429).json({
              error: "Too many requests",
              message:
                "Too many invalid setup code attempts. A new setup code has been issued in backend logs.",
            });
          }
          return res.status(409).json({
            error: "Conflict",
            message:
              "Bootstrap setup code is unavailable or expired. A new setup code has been issued in backend logs.",
          });
        }
        const nextAuthEnabled = parsed.data.enableAuth;
        if (nextAuthEnabled) {
          await ensureBootstrapUserExists(prisma, bootstrapUserId);
        }
        const updated = await upsertAuthModeState({
          prisma,
          defaultSystemConfigId,
          registrationEnabled: systemConfig.registrationEnabled,
          authEnabled: nextAuthEnabled,
        });
        clearAuthEnabledCache();
        if (nextAuthEnabled) {
          await issueBootstrapSetupCodeIfRequired({
            prisma,
            ttlMs: config.bootstrapSetupCodeTtlMs,
            authMode: config.authMode,
            reason: "onboarding_enabled",
          });
        }
        return res.json({
          authEnabled: updated.authEnabled,
          authOnboardingCompleted: updated.authOnboardingCompleted,
          bootstrapRequired: Boolean(nextAuthEnabled),
        });
      } catch (error) {
        console.error("Auth onboarding choice error:", error);
        return res
          .status(500)
          .json({
            error: "Internal server error",
            message: "Failed to apply authentication onboarding choice",
          });
      }
    },
  );
  router.post(
    "/auth-enabled",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        if (config.authMode !== "local") {
          return res
            .status(409)
            .json({
              error: "Conflict",
              message: `Authentication mode is managed by AUTH_MODE=${config.authMode}`,
            });
        }
        if (!requireCsrf(req, res)) return;
        if (!req.user) {
          return res
            .status(401)
            .json({ error: "Unauthorized", message: "User not authenticated" });
        }
        if (req.user.role !== "ADMIN") {
          return res
            .status(403)
            .json({ error: "Forbidden", message: "Admin access required" });
        }
        const parsed = authEnabledToggleSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Bad request", message: "Invalid toggle payload" });
        }
        const systemConfig = await ensureSystemConfig();
        const current = systemConfig.authEnabled;
        const next = parsed.data.enabled;
        if (!current && next) {
          const bootstrap = await prisma.user.findUnique({
            where: { id: bootstrapUserId },
            select: { id: true },
          });
          if (!bootstrap) {
            await ensureBootstrapUserExists(prisma, bootstrapUserId);
          }
        }
        const updated = await upsertAuthModeState({
          prisma,
          defaultSystemConfigId,
          registrationEnabled: systemConfig.registrationEnabled,
          authEnabled: next,
        });
        clearAuthEnabledCache();
        if (!current && next) {
          await issueBootstrapSetupCodeIfRequired({
            prisma,
            ttlMs: config.bootstrapSetupCodeTtlMs,
            authMode: config.authMode,
            reason: "auth_enabled_toggle",
          });
        }
        const bootstrapUser = await prisma.user.findUnique({
          where: { id: bootstrapUserId },
          select: { id: true, isActive: true },
        });
        const activeUsers = await prisma.user.count({
          where: { isActive: true },
        });
        const bootstrapRequired = getBootstrapRequired({
          authEnabled: updated.authEnabled,
          oidcEnforced: config.oidc.enforced,
          bootstrapUser,
          activeUsers,
        });
        res.json({ authEnabled: updated.authEnabled, bootstrapRequired });
      } catch (error) {
        console.error("Auth enabled toggle error:", error);
        res
          .status(500)
          .json({
            error: "Internal server error",
            message: "Failed to update authentication mode",
          });
      }
    },
  );
};
