import assert from "node:assert/strict";
import test from "node:test";
import { Excalidash } from "./lib.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

test("API key auth sends bearer token and paginates canvas lists", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return json({ drawings: [{ id: "d1", name: "Canvas", version: 2 }], totalCount: 1 });
  };
  const client = new Excalidash({ url: "https://example.test", apiKey: "key" });
  const result = await client.listDrawings({ collectionId: "folder", limit: 10, offset: 0 });
  assert.equal(request.options.headers.authorization, "Bearer key");
  assert.match(request.url, /collectionId=folder/);
  assert.equal(result.canvases[0].version, 2);
  assert.equal(result.nextOffset, null);
});

test("scene updates require an expected version", async () => {
  const client = new Excalidash({ url: "https://example.test", apiKey: "key" });
  await assert.rejects(() => client.updateDrawing("d1", { elements: [] }), /expectedVersion/);
});

test("append uses the version read from the server", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "GET") return json({ id: "d1", name: "Canvas", version: 7, elements: [{ id: "old" }], appState: {}, files: {} });
    return json({ id: "d1", name: "Canvas", version: 8, elements: [], appState: {}, files: {} });
  };
  const client = new Excalidash({ url: "https://example.test", apiKey: "key" });
  const result = await client.appendElements("d1", [{ id: "new" }]);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.version, 7);
  assert.deepEqual(body.elements.map((item) => item.id), ["old", "new"]);
  assert.equal(result.version, 8);
});

test("ensureFolderPath reuses siblings and creates only missing descendants", async () => {
  const client = new Excalidash({ url: "https://example.test", apiKey: "key" });
  client.listCollections = async () => [{ id: "clients", name: "Clientes", parentId: null }];
  const created = [];
  client.createCollection = async (name, parentId) => {
    const folder = { id: `id-${created.length}`, name, parentId: parentId ?? null };
    created.push(folder);
    return folder;
  };
  const result = await client.ensureFolderPath(["Clientes", "DLG", "Apresentações"]);
  assert.equal(result.path, "Clientes › DLG › Apresentações");
  assert.deepEqual(created.map((item) => [item.name, item.parentId]), [["DLG", "clients"], ["Apresentações", "id-0"]]);
});

test("share never falls back to a fuzzy user match", async () => {
  const client = new Excalidash({ url: "https://example.test", apiKey: "key" });
  client._get = async () => ({ users: [{ id: "wrong", email: "other@example.com" }] });
  await assert.rejects(() => client.shareDrawing("d1", "target@example.com"), /correspondência exata/);
});

test("public links are always view-only", async () => {
  const client = new Excalidash({ url: "https://example.test", apiKey: "key" });
  let payload;
  client._write = async (_method, _path, body) => { payload = body; return { share: { id: "s1" } }; };
  const result = await client.publicLink("d1", { expiresAt: null });
  assert.equal(payload.permission, "view");
  assert.equal(result.permission, "view");
});
