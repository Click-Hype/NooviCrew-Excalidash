import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileRoutes } from "./files";

const s3Mocks = vi.hoisted(() => ({
  isS3Enabled: vi.fn(),
  downloadObject: vi.fn(),
}));

vi.mock("../s3", () => s3Mocks);

describe("file routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    s3Mocks.isS3Enabled.mockReturnValue(true);
    s3Mocks.downloadObject.mockResolvedValue({
      body: Buffer.from("image"),
      contentType: "image/png",
      etag: '"etag-1"',
    });
  });

  it("proxies private S3 objects for users with collection share access", async () => {
    const prisma = {
      drawing: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            userId: "owner-user",
          })
          .mockResolvedValueOnce({
            collectionId: "shared-collection",
            userId: "owner-user",
          }),
      },
      drawingPermission: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      collection: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({
          id: "shared-collection",
          userId: "owner-user",
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "shared-collection",
            name: "Shared",
            parentId: null,
          },
        ]),
      },
      collectionShare: {
        findFirst: vi.fn().mockResolvedValue({ role: "view" }),
        findMany: vi.fn().mockResolvedValue([
          { collectionId: "shared-collection", role: "view" },
        ]),
      },
      drawingLinkShare: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      s3File: {
        findUnique: vi.fn().mockResolvedValue({
          s3Key: "excalidash/owner-user/drawing-1/file-1.png",
        }),
      },
    };
    const app = express();
    registerFileRoutes(app, {
      prisma: prisma as any,
      requireAuth: (_req, _res, next) => next(),
      optionalAuth: (req, _res, next) => {
        req.user = {
          id: "viewer-user",
          email: "viewer@test.local",
          name: "Viewer",
          role: "USER",
        };
        next();
      },
      asyncHandler: (fn) => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
      },
    });
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error.message });
    });

    const response = await request(app).get("/files/drawing-1/file-1");

    expect(response.status, response.text).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("private, max-age=3600");
    expect(response.body).toEqual(Buffer.from("image"));
    expect(s3Mocks.downloadObject).toHaveBeenCalledWith(
      "excalidash/owner-user/drawing-1/file-1.png",
    );
    expect(prisma.collectionShare.findMany).toHaveBeenCalledWith({
      where: {
        granteeUserId: "viewer-user",
        collectionId: { in: ["shared-collection"] },
      },
      select: { collectionId: true, role: true },
    });
  });
});
