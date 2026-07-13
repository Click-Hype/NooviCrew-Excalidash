import { describe, expect, it } from "vitest";
import {
  validateProductionConfig,
  type ProductionValidationConfig,
} from "./production";

const buildConfig = (
  overrides: Partial<ProductionValidationConfig> = {},
): ProductionValidationConfig => ({
  jwtSecret: "j".repeat(32),
  csrfSecret: "c".repeat(32),
  jwtAccessExpiresIn: "15m",
  jwtRefreshExpiresIn: "7d",
  oidc: { enabled: false, redirectUri: null },
  ...overrides,
});

describe("production configuration security", () => {
  it("requires an explicit durable CSRF secret", () => {
    expect(() =>
      validateProductionConfig(buildConfig({ csrfSecret: null })),
    ).toThrow(/CSRF_SECRET/);
    expect(() =>
      validateProductionConfig(buildConfig({ csrfSecret: "short" })),
    ).toThrow(/CSRF_SECRET/);
  });

  it("rejects invalid or excessive token durations", () => {
    expect(() =>
      validateProductionConfig(
        buildConfig({ jwtAccessExpiresIn: "not-a-duration" }),
      ),
    ).toThrow(/JWT_ACCESS_EXPIRES_IN/);
    expect(() =>
      validateProductionConfig(buildConfig({ jwtAccessExpiresIn: "25h" })),
    ).toThrow(/24 hours/);
    expect(() =>
      validateProductionConfig(buildConfig({ jwtRefreshExpiresIn: "10m" })),
    ).toThrow(/must be longer/);
  });

  it("accepts bounded access and refresh durations", () => {
    expect(() => validateProductionConfig(buildConfig())).not.toThrow();
  });
});
