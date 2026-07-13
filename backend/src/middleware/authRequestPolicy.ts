import { Request, Response } from "express";

const normalizeRequestPath = (req: Request): string => {
  const raw = (req.originalUrl || req.url || "").split("?")[0] || "";
  return raw.replace(/^\/api(?=\/)/, "");
};

export const isAllowedWhileMustResetPassword = (req: Request): boolean => {
  const path = normalizeRequestPath(req);
  if (req.method === "GET" && path === "/auth/me") return true;
  if (req.method === "POST" && path === "/auth/change-password") return true;
  return req.method === "POST" && path === "/auth/must-reset-password";
};

export const isApiKeySelfIdentityRoute = (req: Request): boolean =>
  req.method === "GET" && normalizeRequestPath(req) === "/auth/me";

export const getRequiredApiKeyScope = (req: Request): string | null => {
  const segments = normalizeRequestPath(req).split("/").filter(Boolean);
  const method = req.method;
  if (segments[0] === "drawings") {
    if (
      segments.length >= 3 &&
      ["share-resolve", "sharing", "permissions", "link-shares"].includes(
        segments[2],
      )
    ) {
      return "sharing:write";
    }
    if (segments.length >= 3 && segments[2] === "history") {
      return method === "GET" || method === "HEAD" ? "history:read" : null;
    }
    if (segments.length === 1 && ["GET", "HEAD", "POST"].includes(method)) {
      return method === "GET" || method === "HEAD"
        ? "drawings:read"
        : "drawings:write";
    }
    if (
      segments.length === 2 &&
      segments[1] !== "shared" &&
      ["GET", "HEAD", "PUT", "DELETE"].includes(method)
    ) {
      return method === "GET" || method === "HEAD"
        ? "drawings:read"
        : "drawings:write";
    }
    return null;
  }
  if (segments[0] === "collections") {
    if (
      segments.length >= 3 &&
      ["shares", "share-resolve"].includes(segments[2])
    ) {
      return "sharing:write";
    }
    if (segments.length === 1 && ["GET", "HEAD", "POST"].includes(method)) {
      return method === "GET" || method === "HEAD"
        ? "collections:read"
        : "collections:write";
    }
    if (segments.length === 2 && ["PUT", "DELETE"].includes(method)) {
      return "collections:write";
    }
  }
  return null;
};

export const authorizeApiKeyRequest = (
  req: Request,
  res: Response,
  scopes: string[],
): boolean => {
  if (isApiKeySelfIdentityRoute(req)) return true;
  const requiredScope = getRequiredApiKeyScope(req);
  if (requiredScope && scopes.includes(requiredScope)) return true;
  res.status(403).json({
    error: "Forbidden",
    message: "API key is not authorized for this route",
  });
  return false;
};
