import type { NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { createAuthMiddleware } from "./auth";
import { createDeps, createRequest, createResponse } from "./authTestHelpers";

describe("auth middleware API key authentication", () => {
  it("attaches active user for valid API key", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: "user-1",
      email: "user-1@test.local",
      authCredentialType: "apiKey",
    });
    expect(req.principal).toEqual({ kind: "user", userId: "user-1" });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: "api-key-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("allows valid API key auth when lastUsedAt update fails", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockRejectedValue(new Error("write failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "GET",
      originalUrl: "/drawings",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects API keys for routes outside drawings and collections", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "admin-1",
        username: "admin",
        email: "admin@test.local",
        name: "Admin",
        role: "ADMIN",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "GET",
      originalUrl: "/auth/api-keys",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an API key to read its own /auth/me identity", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(["drawings:read"]),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "GET",
      originalUrl: "/auth/me",
      headers: { authorization: `Bearer ${generated.token}` },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.authCredentialType).toBe("apiKey");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects API keys for drawing permission subroutes", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "POST",
      originalUrl: "/drawings/drawing-1/permissions",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows sharing subroutes only with the opt-in sharing scope", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(["sharing:write"]),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "POST",
      originalUrl: "/drawings/drawing-1/link-shares",
      headers: { authorization: `Bearer ${generated.token}` },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    const collectionReq = createRequest({
      method: "POST",
      originalUrl: "/collections/collection-1/shares",
      headers: { authorization: `Bearer ${generated.token}` },
    });
    const collectionRes = createResponse();
    const collectionNext = vi.fn() as NextFunction;
    await requireAuth(collectionReq, collectionRes, collectionNext);
    expect(collectionNext).toHaveBeenCalledTimes(1);
    expect(collectionRes.status).not.toHaveBeenCalled();
  });

  it("allows owner history requests only with the opt-in history scope", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(["history:read"]),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { optionalAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "GET",
      originalUrl: "/drawings/drawing-1/history",
      headers: { authorization: `Bearer ${generated.token}` },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.authCredentialType).toBe("apiKey");
    expect(req.authError).toBeUndefined();
  });

  it("does not send 403 from optionalAuth when API key is not route-authorized", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { optionalAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "GET",
      originalUrl: "/drawings/drawing-1/history",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await optionalAuth(req, res, next);
    expect(req.user).toBeUndefined();
    expect(req.authError).toEqual({ code: "INVALID_ACCESS_TOKEN" });
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects API keys missing the required resource scope", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(["drawings:read"]),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      method: "POST",
      originalUrl: "/drawings",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects revoked API keys", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      revokedAt: new Date(),
      user: { isActive: true },
    });
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid or revoked API key" }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
