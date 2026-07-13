import { Request } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  readCookie,
} from "../auth/cookies";

export interface JwtPayload {
  userId: string;
  email: string;
  type: "access" | "refresh";
  impersonatorId?: string;
  authProvider?: "local" | "oidc";
  oidcGroups?: string[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isJwtPayload = (decoded: unknown): decoded is JwtPayload => {
  if (typeof decoded !== "object" || decoded === null) return false;
  const payload = decoded as Record<string, unknown>;
  return (
    typeof payload.userId === "string" &&
    typeof payload.email === "string" &&
    (payload.type === "access" || payload.type === "refresh") &&
    (payload.impersonatorId === undefined ||
      typeof payload.impersonatorId === "string") &&
    (payload.authProvider === undefined ||
      payload.authProvider === "local" ||
      payload.authProvider === "oidc") &&
    (payload.oidcGroups === undefined || isStringArray(payload.oidcGroups))
  );
};

export const extractAuthToken = (
  req: Request,
): { token: string; source: "bearer" | "cookie" } | null => {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer") {
      return parts[1] ? { token: parts[1], source: "bearer" } : null;
    }
  }
  const cookieToken = readCookie(req, ACCESS_TOKEN_COOKIE_NAME);
  return cookieToken ? { token: cookieToken, source: "cookie" } : null;
};

export const hasRefreshTokenCookie = (req: Request): boolean =>
  readCookie(req, REFRESH_TOKEN_COOKIE_NAME) !== null;

export const verifyAccessToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    return isJwtPayload(decoded) && decoded.type === "access" ? decoded : null;
  } catch {
    return null;
  }
};
