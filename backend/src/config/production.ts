import ms, { type StringValue } from "ms";

export type ProductionValidationConfig = {
  jwtSecret: string;
  csrfSecret: string | null;
  jwtAccessExpiresIn: string;
  jwtRefreshExpiresIn: string;
  oidc: {
    enabled: boolean;
    redirectUri: string | null;
  };
};

export const validateProductionConfig = (config: ProductionValidationConfig): void => {
  const normalizedSecret = config.jwtSecret.trim();
  const insecureJwtSecretPlaceholders = new Set([
    "your-secret-key-change-in-production",
    "change-this-secret-in-production-min-32-chars",
  ]);

  if (config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long in production");
  }
  if (insecureJwtSecretPlaceholders.has(normalizedSecret)) {
    throw new Error("JWT_SECRET must be changed from placeholder/default value in production");
  }
  const normalizedCsrfSecret = config.csrfSecret?.trim() ?? "";
  if (normalizedCsrfSecret.length < 32) {
    throw new Error(
      "CSRF_SECRET must be explicitly set to at least 32 characters in production",
    );
  }

  const parseDuration = (name: string, value: string): number => {
    const parsed = ms(value as StringValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a valid positive duration`);
    }
    return parsed;
  };
  const accessDurationMs = parseDuration(
    "JWT_ACCESS_EXPIRES_IN",
    config.jwtAccessExpiresIn,
  );
  const refreshDurationMs = parseDuration(
    "JWT_REFRESH_EXPIRES_IN",
    config.jwtRefreshExpiresIn,
  );
  if (accessDurationMs > 24 * 60 * 60 * 1000) {
    throw new Error("JWT_ACCESS_EXPIRES_IN must not exceed 24 hours");
  }
  if (refreshDurationMs <= accessDurationMs) {
    throw new Error(
      "JWT_REFRESH_EXPIRES_IN must be longer than JWT_ACCESS_EXPIRES_IN",
    );
  }
  if (refreshDurationMs > 365 * 24 * 60 * 60 * 1000) {
    throw new Error("JWT_REFRESH_EXPIRES_IN must not exceed 365 days");
  }
  if (config.oidc.enabled && config.oidc.redirectUri && !/^https:\/\//i.test(config.oidc.redirectUri)) {
    throw new Error("OIDC_REDIRECT_URI must be HTTPS in production");
  }
};
