import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../authz/sharing", () => ({
  canEditDrawing: (access: string) => access === "edit" || access === "owner",
  getDrawingAccess: vi.fn().mockResolvedValue("owner"),
  isOwnerAccess: (access: string) => access === "owner",
}));

vi.mock("../../fileProcessing", () => ({
  rewritePreviewForS3: (preview: unknown) => preview,
}));

import { registerDrawingCreateUpdateRoutes } from "./drawingCreateUpdateRoutes";

const user = {
  id: "agent-user",
  email: "agent@example.com",
  name: "Agent",
  role: "USER",
  authCredentialType: "apiKey" as const,
};

const drawing = (overrides: Record<string, unknown> = {}) => ({
  id: "drawing-1",
  name: "Canvas",
  elements: "[]",
  appState: "{}",
  files: "{}",
  preview: null,
  collectionId: null,
  userId: user.id,
  version: 4,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const createApp = (prisma: any, emit = vi.fn()) => {
  const app = express();
  app.use(express.json());
  const authenticate: express.RequestHandler = (req, _res, next) => {
    req.user = user;
    next();
  };
  registerDrawingCreateUpdateRoutes(app, {
    prisma,
    io: { to: vi.fn(() => ({ emit })) },
    requireAuth: authenticate,
    optionalAuth: authenticate,
    asyncHandler: (handler: any) => (req: any, res: any, next: any) =>
      Promise.resolve(handler(req, res, next)).catch(next),
    validateImportedDrawing: vi.fn(() => true),
    drawingCreateSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
    drawingUpdateSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
    respondWithValidationErrors: vi.fn(),
    ensureTrashCollection: vi.fn(),
    invalidateDrawingsCache: vi.fn(),
    config: { nodeEnv: "test" },
    processFilesForS3: vi.fn(async (files: unknown) => files),
    parseJsonField: (value: string | null | undefined, fallback: unknown) =>
      value ? JSON.parse(value) : fallback,
    getRequestPrincipal: vi.fn(async () => ({ kind: "user", userId: user.id })),
    respondWithAuthErrorIfPresent: vi.fn(() => false),
  } as any);
  return { app, emit };
};

describe("drawing write preconditions for agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a version for every scene update", async () => {
    const prisma = {
      drawing: { findUnique: vi.fn().mockResolvedValue(drawing()) },
    };
    const { app } = createApp(prisma);

    const response = await request(app)
      .put("/drawings/drawing-1")
      .send({ elements: [] });

    expect(response.status).toBe(428);
    expect(response.body).toMatchObject({
      code: "VERSION_REQUIRED",
      currentVersion: 4,
    });
  });

  it("replays a create with the same idempotency key", async () => {
    let stored: ReturnType<typeof drawing> | null = null;
    const create = vi.fn(async ({ data }: any) => {
      stored = drawing({ ...data, version: 1 });
      return stored;
    });
    const prisma = {
      collection: { findFirst: vi.fn() },
      drawing: {
        findFirst: vi.fn(async ({ where }: any) =>
          stored?.id === where.id ? stored : null,
        ),
        create,
      },
    };
    const { app } = createApp(prisma);
    const payload = { name: "Agent canvas", elements: [], appState: {}, files: {} };

    const first = await request(app)
      .post("/drawings")
      .set("Idempotency-Key", "operation-2026-01") // gitleaks:allow -- test fixture
      .send(payload);
    const replay = await request(app)
      .post("/drawings")
      .set("Idempotency-Key", "operation-2026-01") // gitleaks:allow -- test fixture
      .send(payload);

    expect(first.status).toBe(200);
    expect(first.headers["idempotency-replayed"]).toBe("false");
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.id).toBe(first.body.id);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("notifies open editors after an API-key scene update", async () => {
    const updated = drawing({ version: 5, updatedAt: new Date("2026-01-02T00:00:00Z") });
    const tx = {
      drawingSnapshot: { create: vi.fn() },
      drawing: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(updated),
      },
    };
    const prisma = {
      drawing: { findUnique: vi.fn().mockResolvedValue(drawing()) },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const emit = vi.fn();
    const { app } = createApp(prisma, emit);

    const response = await request(app)
      .put("/drawings/drawing-1")
      .send({ elements: [], version: 4 });

    expect(response.status).toBe(200);
    expect(response.body.version).toBe(5);
    expect(emit).toHaveBeenCalledWith(
      "drawing-server-update",
      expect.objectContaining({ drawingId: "drawing-1", version: 5 }),
    );
  });
});
