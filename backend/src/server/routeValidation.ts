import express from "express";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { z } from "zod";
import { config } from "../config";
import {
  appStateSchema,
  elementSchema,
  sanitizeDrawingData,
  sanitizeSvg,
} from "../security";

const filesFieldSchema = z
  .union([z.record(z.string(), z.unknown()), z.null()])
  .optional()
  .transform((value) => (value === null ? undefined : value));
const drawingBaseSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  collectionId: z.union([z.string().trim().min(1), z.null()]).optional(),
  preview: z.string().nullable().optional(),
});
export const drawingCreateSchema = drawingBaseSchema
  .extend({
    elements: elementSchema.array().default([]),
    appState: appStateSchema.default({}),
    files: filesFieldSchema,
  })
  .refine(
    (data) => {
      try {
        Object.assign(data, sanitizeDrawingData(data));
        return true;
      } catch (error) {
        console.error("Sanitization failed:", error);
        return false;
      }
    },
    { message: "Invalid or malicious drawing data detected" },
  );
const drawingUpdateSchemaBase = drawingBaseSchema.extend({
  elements: elementSchema.array().optional(),
  appState: appStateSchema.optional(),
  files: filesFieldSchema,
  version: z.number().int().positive().optional(),
});

export const sanitizeDrawingUpdateData = (data: {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  preview?: string | null;
  name?: string;
  collectionId?: string | null;
}): boolean => {
  const hasSceneFields =
    data.elements !== undefined ||
    data.appState !== undefined ||
    data.files !== undefined;
  const hasPreviewField = data.preview !== undefined;
  const needsSanitization = hasSceneFields || hasPreviewField;
  try {
    const sanitizedData = { ...data };
    if (hasSceneFields) {
      const fullData = {
        elements: Array.isArray(data.elements) ? data.elements : [],
        appState:
          typeof data.appState === "object" && data.appState !== null
            ? data.appState
            : {},
        files: data.files || {},
        preview: data.preview,
        name: data.name,
        collectionId: data.collectionId,
      };
      const sanitized = sanitizeDrawingData(fullData);
      if (data.elements !== undefined) sanitizedData.elements = sanitized.elements;
      if (data.appState !== undefined) sanitizedData.appState = sanitized.appState;
      if (data.files !== undefined) sanitizedData.files = sanitized.files;
      if (data.preview !== undefined) sanitizedData.preview = sanitized.preview;
      Object.assign(data, sanitizedData);
    } else if (hasPreviewField && typeof data.preview === "string") {
      data.preview = sanitizeSvg(data.preview);
      Object.assign(data, { ...data, preview: data.preview });
    } else if (hasPreviewField && data.preview === null) {
      Object.assign(data, sanitizedData);
    }
    return true;
  } catch (error) {
    console.error("Sanitization failed:", error);
    return needsSanitization ? false : true;
  }
};

export const drawingUpdateSchema = drawingUpdateSchemaBase.refine(
  (data) => sanitizeDrawingUpdateData(data as any),
  { message: "Invalid or malicious drawing data detected" },
);
export const respondWithValidationErrors = (
  res: express.Response,
  issues: z.ZodIssue[],
) => {
  if (config.nodeEnv === "production") {
    res.status(400).json({
      error: "Validation error",
      message: "Invalid request data",
    });
  } else {
    res.status(400).json({ error: "Invalid drawing payload", details: issues });
  }
};
export const collectionNameSchema = z.string().trim().min(1).max(100);

const validateSqliteHeader = (filePath: string): boolean => {
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (bytesRead < 16) {
      console.warn("File too small to be a valid SQLite database");
      return false;
    }
    const expectedHeader = Buffer.from([
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61,
      0x74, 0x20, 0x33, 0x00,
    ]);
    const isValid = buffer.equals(expectedHeader);
    if (!isValid) {
      console.warn("Invalid SQLite file header detected", {
        filePath,
        header: buffer.toString("hex"),
        expected: expectedHeader.toString("hex"),
      });
    }
    return isValid;
  } catch (error) {
    console.error("Failed to validate SQLite header:", error);
    return false;
  }
};

export const verifyDatabaseIntegrityAsync = (filePath: string): Promise<boolean> => {
  if (!validateSqliteHeader(filePath)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const worker = new Worker(
      path.resolve(__dirname, "../workers/db-verify.js"),
      { workerData: { filePath } },
    );
    let timeoutHandle: NodeJS.Timeout;
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };
    worker.on("message", (isValid: boolean) => finish(isValid));
    worker.on("error", (error) => {
      console.error("Worker error:", error);
      finish(false);
    });
    worker.on("exit", (code) => {
      if (code !== 0) finish(false);
    });
    timeoutHandle = setTimeout(() => {
      console.warn("Integrity check worker timed out", { filePath });
      worker.terminate();
      finish(false);
    }, 10000);
  });
};

export const removeFileIfExists = async (filePath?: string) => {
  if (!filePath) return;
  try {
    await fsPromises.access(filePath).catch(() => undefined);
    await fsPromises.unlink(filePath);
  } catch (error) {
    console.error("Failed to remove file", { filePath, error });
  }
};
