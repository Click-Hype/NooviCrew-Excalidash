#!/usr/bin/env node
// CLI do Excalidash — mesmas operações do MCP, para agentes (CLI) e humanos.
// Uso: node excalidash/cli.mjs <cmd> [args...] | JSON in/out.
//   whoami
//   folders                          -> árvore de pastas
//   create-folder <nome> [parentId]  -> cria pasta/subpasta
//   canvases [folderId]              -> lista canvas
//   create-canvas <nome> [folderId]  -> cria canvas
//   get-canvas <id>
//   render <folderId|-> <json|@arquivo>   -> render_presentation (spec JSON no stdin/arquivo/arg)
// Env: EXCALIDASH_URL, EXCALIDASH_EMAIL, EXCALIDASH_PASSWORD.
import fs from "node:fs";
import crypto from "node:crypto";
import { Excalidash, buildPresentation, APPSTATE, boxElements, textElements, arrowElements, stickyElements } from "./lib.mjs";

const [cmd, ...args] = process.argv.slice(2);
const c = new Excalidash();
const out = (o) => console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2));

function readSpec(arg) {
  let raw = arg;
  if (!raw || raw === "-") raw = fs.readFileSync(0, "utf-8");
  else if (raw.startsWith("@")) raw = fs.readFileSync(raw.slice(1), "utf-8");
  return JSON.parse(raw);
}

try {
  switch (cmd) {
    case "whoami": out(await c.me()); break;
    case "folders": {
      const cols = await c.listCollections();
      const byId = new Map(cols.map((x) => [x.id, { ...x, children: [] }]));
      const roots = [];
      for (const x of byId.values()) { const p = x.parentId && byId.get(x.parentId); if (p) p.children.push(x); else roots.push(x); }
      const fmt = (n, d = 0) => [`${"  ".repeat(d)}📁 ${n.name} [${n.id}]`, ...n.children.flatMap((ch) => fmt(ch, d + 1))];
      out(roots.flatMap((r) => fmt(r)).join("\n") || "(nenhuma pasta)");
      break;
    }
    case "create-folder": out(await c.createCollection(args[0], args[1])); break;
    case "ensure-folder": out(await c.ensureFolderPath(args.join(" "))); break;
    case "canvases": out(await c.listDrawings({ collectionId: args[0], search: args[1], limit: 100 })); break;
    case "create-canvas": out(await c.createDrawing({ name: args[0], collectionId: args[1], idempotencyKey: args[2] || crypto.randomUUID() })); break;
    case "get-canvas": out(await c.getDrawing(args[0])); break;
    case "move-canvas": out(await c.updateDrawing(args[0], { collectionId: args[1] || null })); break;
    case "rename-canvas": out(await c.updateDrawing(args[0], { name: args.slice(1).join(" ") })); break;
    case "move-folder": out(await c.updateCollection(args[0], { parentId: args[1] || null })); break;
    case "rename-folder": out(await c.updateCollection(args[0], { name: args.slice(1).join(" ") })); break;
    case "share": out(await c.shareDrawing(args[0], args[1], args[2] || "view")); break;
    case "public-link": out(await c.publicLink(args[0], { expiresAt: args[1] || null })); break;
    case "sharing": out(await c.getSharing(args[0])); break;
    case "revoke-public-link": out(await c.revokePublicLink(args[0], args[1])); break;
    case "write-scene": out(await c.updateDrawing(args[0], { elements: readSpec(args[2]), expectedVersion: Number(args[1]) })); break;
    case "add-box": out(await c.appendElements(args[0], boxElements(+args[1], +args[2], +args[3] || 220, +args[4] || 90, args[5] || "", args[6] || "blue"))); break;
    case "add-text": out(await c.appendElements(args[0], textElements(+args[1], +args[2], args.slice(3).join(" ")))); break;
    case "add-arrow": out(await c.appendElements(args[0], arrowElements(+args[1], +args[2], +args[3], +args[4]))); break;
    case "add-sticky": out(await c.appendElements(args[0], stickyElements(+args[1], +args[2], args.slice(3).join(" ")))); break;
    case "render": {
      const folderId = args[0] && args[0] !== "-" ? args[0] : undefined;
      const spec = readSpec(args[1]);
      const elements = buildPresentation(spec);
      const res = spec.drawingId
        ? await c.updateDrawing(spec.drawingId, { elements, appState: APPSTATE, expectedVersion: Number(spec.expectedVersion) })
        : await c.createDrawing({ name: spec.name || spec.title, collectionId: folderId, elements, appState: APPSTATE, idempotencyKey: spec.requestId || crypto.randomUUID() });
      out({ ...res, elementsCount: elements.length });
      break;
    }
    default:
      out([
        "cmds:",
        "  whoami | folders | canvases [folderId]",
        "  ensure-folder 'Clientes › Cliente › Projeto' | create-folder <nome> [parentId]",
        "  rename-folder <id> <nome> | move-folder <id> [parentId]",
        "  create-canvas <nome> [folderId] [requestId] | get-canvas <id> | rename-canvas <id> <nome> | move-canvas <id> [folderId]",
        "  share <drawingId> <email> [view|edit] | public-link <drawingId> [expiresAt] | sharing <drawingId> | revoke-public-link <drawingId> <shareId>",
        "  render <folderId|-> <@spec.json> | write-scene <id> <expectedVersion> <@elements.json>",
        "  add-box <id> <x> <y> [w] [h] [label] [color] | add-text <id> <x> <y> <texto>",
        "  add-arrow <id> <x1> <y1> <x2> <y2> | add-sticky <id> <x> <y> <texto>",
      ].join("\n"));
  }
} catch (e) {
  console.error("ERRO:", e.message);
  process.exit(1);
}
