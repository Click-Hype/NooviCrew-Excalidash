import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing, getDrawing, updateDrawing } from "./helpers/api";

/**
 * E2E regression for the "Saving paused because a newer server version exists"
 * dead end.
 *
 * Scene saves are guarded by an optimistic-locking version that the editor only
 * learns from its own successful save. Any write it does not observe (an
 * API-key write, or its own write whose response was lost) left the editor
 * pinned to a stale version, so every later autosave failed with 409 until the
 * user reloaded — discarding everything drawn meanwhile.
 */

const revealEditorHeader = async (page: Page) => {
  await page.mouse.move(24, 2);
  await page.waitForTimeout(150);
};

const drawRectangle = async (page: Page, offsetX: number) => {
  const canvas = page.locator("canvas.excalidraw__canvas.interactive");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  await page.waitForTimeout(300);
  const startX = box.x + box.width / 2 + offsetX - 60;
  const startY = box.y + box.height / 2 - 40;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 80, { steps: 20 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
};

const agentElement = (id: string) => ({
  id,
  type: "rectangle",
  x: 600,
  y: 600,
  width: 120,
  height: 90,
  angle: 0,
  strokeColor: "#000000",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: { type: 3 },
  seed: 4242,
  version: 1,
  versionNonce: 4242,
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
});

test.describe("Autosave conflict recovery", () => {
  let createdDrawingIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdDrawingIds) {
      try {
        await deleteDrawing(request, id);
      } catch {
        // best effort cleanup
      }
    }
    createdDrawingIds = [];
  });

  test("keeps saving after the server version moves ahead of the editor", async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, {
      name: `Autosave_Conflict_${Date.now()}`,
      elements: [],
    });
    createdDrawingIds.push(drawing.id);

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("[class*='excalidraw'], canvas", { timeout: 15000 });
    await page.waitForTimeout(1500);

    await drawRectangle(page, -160);
    await expect
      .poll(
        async () => (await getDrawing(request, drawing.id)).elements?.length || 0,
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);

    // Out-of-band write: the editor keeps the version it last saw.
    const current = await getDrawing(request, drawing.id);
    await updateDrawing(request, drawing.id, {
      elements: [...(current.elements || []), agentElement("agent-injected")],
      version: current.version,
    });

    await drawRectangle(page, 160);

    // The autosave rebases on the server scene instead of pausing: both the
    // out-of-band element and the newly drawn one survive.
    await expect
      .poll(
        async () => {
          const saved = await getDrawing(request, drawing.id);
          const ids = (saved.elements || []).map((element: any) => element.id);
          return ids.includes("agent-injected") && ids.length >= 3;
        },
        { timeout: 20000 },
      )
      .toBe(true);

    await expect(
      page.getByText("Saving paused because a newer server version exists."),
    ).toHaveCount(0);
    await revealEditorHeader(page);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });
});
