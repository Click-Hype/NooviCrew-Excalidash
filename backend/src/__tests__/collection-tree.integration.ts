import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { StringValue } from "ms";
import request from "supertest";
import type { PrismaClient } from "../generated/client";
import { config } from "../config";
import { getTestPrisma, setupTestDb } from "./testUtils";

describe("Collection tree integration", () => {
  const userAgent = "vitest-collection-tree";
  let prisma: PrismaClient;
  let app: any;
  let owner: { id: string; email: string };
  let editor: { id: string; email: string };
  let ownerToken: string;
  let editorToken: string;
  let ownerAgent: any;
  let editorAgent: any;
  let ownerCsrf: { header: string; token: string };
  let editorCsrf: { header: string; token: string };

  const createUser = async (email: string, name: string) =>
    prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash("password123", 10),
        isActive: true,
      },
      select: { id: true, email: true },
    });

  const sign = (user: { id: string; email: string }) =>
    jwt.sign(
      { userId: user.id, email: user.email, type: "access" },
      config.jwtSecret,
      { expiresIn: config.jwtAccessExpiresIn as StringValue } as SignOptions,
    );

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true },
      create: { id: "default", authEnabled: true },
    });
    owner = await createUser("tree-owner@test.local", "Tree Owner");
    editor = await createUser("tree-editor@test.local", "Tree Editor");
    ownerToken = sign(owner);
    editorToken = sign(editor);
    ownerAgent = request.agent(app);
    editorAgent = request.agent(app);
    const ownerCsrfResponse = await ownerAgent.get("/csrf-token").set("User-Agent", userAgent);
    const editorCsrfResponse = await editorAgent.get("/csrf-token").set("User-Agent", userAgent);
    ownerCsrf = ownerCsrfResponse.body;
    editorCsrf = editorCsrfResponse.body;
  }, 120000);

  afterAll(async () => prisma.$disconnect());

  const createDrawing = (collectionId: string) =>
    prisma.drawing.create({
      data: {
        name: "Nested drawing",
        elements: "[]",
        appState: "{}",
        files: "{}",
        userId: owner.id,
        collectionId,
      },
    });

  it("creates and moves subfolders while keeping sibling names unambiguous", async () => {
    const create = (name: string, parentId?: string) =>
      ownerAgent
        .post("/collections")
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${ownerToken}`)
        .set(ownerCsrf.header, ownerCsrf.token)
        .send(parentId ? { name, parentId } : { name });
    const firstRoot = await create("First root");
    const secondRoot = await create("Second root");
    const child = await create("Planning", firstRoot.body.id);
    expect(child.body).toMatchObject({ parentId: firstRoot.body.id });

    const moved = await ownerAgent
      .put(`/collections/${child.body.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.header, ownerCsrf.token)
      .send({ parentId: secondRoot.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      parentId: secondRoot.body.id,
      path: "Second root / Planning",
    });

    const duplicate = await create("planning", secondRoot.body.id);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toContain("unique");
  });

  it("inherits a root share across the complete subfolder tree", async () => {
    const root = await prisma.collection.create({ data: { name: "Client", userId: owner.id } });
    const child = await prisma.collection.create({
      data: { name: "Planning", userId: owner.id, parentId: root.id },
    });
    const leaf = await prisma.collection.create({
      data: { name: "Week 1", userId: owner.id, parentId: child.id },
    });
    await createDrawing(leaf.id);

    const share = await ownerAgent
      .post(`/collections/${root.id}/shares`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.header, ownerCsrf.token)
      .send({ identifier: editor.email, role: "edit" });
    expect(share.status).toBe(200);

    const collections = await request(app)
      .get("/collections")
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${editorToken}`);
    expect((collections.body as any[]).find((item) => item.id === leaf.id)).toMatchObject({
      parentId: child.id,
      path: "Client / Planning / Week 1",
      sharedRole: "edit",
      shareSourceCollectionId: root.id,
      sharedViaAncestor: true,
    });

    const drawings = await request(app)
      .get(`/drawings?collectionId=${leaf.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${editorToken}`);
    expect(drawings.status).toBe(200);
    expect(drawings.body.drawings).toHaveLength(1);

    const create = await editorAgent
      .post("/drawings")
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${editorToken}`)
      .set(editorCsrf.header, editorCsrf.token)
      .send({ name: "Inherited editor drawing", elements: [], appState: {}, files: {}, collectionId: leaf.id });
    expect(create.status).toBe(200);
  });

  it("rejects cycles and recursively deletes a subtree without deleting drawings", async () => {
    const root = await prisma.collection.create({ data: { name: "Delete root", userId: owner.id } });
    const child = await prisma.collection.create({
      data: { name: "Delete child", userId: owner.id, parentId: root.id },
    });
    const drawing = await createDrawing(child.id);
    const cycle = await ownerAgent
      .put(`/collections/${root.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.header, ownerCsrf.token)
      .send({ parentId: child.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.message).toContain("cycle");

    const deleted = await ownerAgent
      .delete(`/collections/${root.id}`)
      .set("User-Agent", userAgent)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set(ownerCsrf.header, ownerCsrf.token);
    expect(deleted.body).toMatchObject({ success: true, deletedCollections: 2, movedDrawings: 1 });
    expect(await prisma.collection.count({ where: { id: { in: [root.id, child.id] } } })).toBe(0);
    expect(await prisma.drawing.findUnique({ where: { id: drawing.id } })).toMatchObject({ collectionId: null });
  });
});
