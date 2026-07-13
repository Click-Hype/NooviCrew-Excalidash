import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { registerCsrfProtection } from "./csrf";
import {
  createHttpsRedirectPolicy,
  getHttpsRedirectUrl,
} from "./httpsRedirectPolicy";

export const registerHttpMiddleware = (params: {
  app: express.Express;
  authRouter: express.Router;
  allowedOrigins: string[];
  isAllowedOrigin: (origin?: string) => boolean;
}) => {
  const { app, authRouter, allowedOrigins, isAllowedOrigin } = params;
  app.use((req, res, next) => {
    const requestId = uuidv4();
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  });

  const shouldEnforceHttps =
    config.nodeEnv === "production" &&
    config.enforceHttpsRedirect &&
    allowedOrigins.some((origin) => origin.toLowerCase().startsWith("https://"));
  if (shouldEnforceHttps) {
    const httpsRedirectPolicy = createHttpsRedirectPolicy(allowedOrigins);
    app.use((req, res, next) => {
      const redirectUrl = getHttpsRedirectUrl(req, httpsRedirectPolicy);
      if (!redirectUrl) return next();
      return res.redirect(redirectUrl);
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-csrf-token",
        "x-imported-file",
        "Idempotency-Key",
      ],
      exposedHeaders: [
        "x-csrf-token",
        "x-request-id",
        "Idempotency-Replayed",
      ],
    }),
  );

  app.use((req, res, next) => {
    const requestId = req.headers["x-request-id"] || "unknown";
    const contentLength = req.headers["content-length"];
    const startedAt = Date.now();
    res.on("finish", () => {
      const userEmail = req.user?.email || "anonymous";
      const sizeInMB = contentLength
        ? Number.parseInt(contentLength, 10) / 1024 / 1024
        : 0;
      if (Number.isFinite(sizeInMB) && sizeInMB > 10) {
        console.log(
          `[LARGE REQUEST] ${req.method} ${req.path} - ${sizeInMB.toFixed(2)}MB - User: ${userEmail} - RequestID: ${requestId}`,
        );
      }
      console.log(
        `[REQUEST] ${req.method} ${req.path} - ${res.statusCode} - ${Date.now() - startedAt}ms - User: ${userEmail} - IP: ${req.ip} - RequestID: ${requestId}`,
      );
    });
    next();
  });

  const generalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.rateLimitMaxRequests,
    message: {
      error: "Rate limit exceeded",
      message: "Too many requests, please try again later",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, xForwardedForHeader: false },
  });
  app.use(generalRateLimiter);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  registerCsrfProtection({
    app,
    isAllowedOrigin,
    maxRequestsPerWindow: config.csrfMaxRequests,
    enableDebugLogging: process.env.DEBUG_CSRF === "true",
  });
  app.use("/auth", authRouter);
};
