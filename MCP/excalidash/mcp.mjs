#!/usr/bin/env node
// MCP stdio do ExcaliDash persistente para Hermes agents.
// Autenticação preferencial: EXCALIDASH_API_KEY. Senha/cookie é fallback legado.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  APPSTATE,
  Excalidash,
  ExcalidashHttpError,
  arrowElements,
  boxElements,
  buildPresentation,
  stickyElements,
  textElements,
} from "./lib.mjs";

const client = new Excalidash();

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const TOOLS = [
  { name: "whoami", description: "Confirma a identidade e o endpoint ExcaliDash usados por este agent.", inputSchema: objectSchema({}) },
  { name: "list_folders", description: "Lista todas as pastas visíveis como árvore e inclui path completo. Chame antes de criar/mover.", inputSchema: objectSchema({}) },
  { name: "ensure_folder_path", description: "Resolve ou cria idempotentemente um caminho de pastas, por exemplo ['Clientes','DLG','Apresentações']. Reuse-first recomendado.", inputSchema: objectSchema({ path: { oneOf: [{ type: "string" }, { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }] } }, ["path"]) },
  { name: "create_folder", description: "Cria uma pasta única. Prefira ensure_folder_path para evitar duplicatas.", inputSchema: objectSchema({ name: { type: "string", minLength: 1, maxLength: 100 }, parentId: { type: "string", minLength: 1 } }, ["name"]) },
  { name: "move_folder", description: "Move uma pasta para outra; parentId null move para a raiz. O backend bloqueia ciclos.", inputSchema: objectSchema({ folderId: { type: "string" }, parentId: { type: ["string", "null"] } }, ["folderId", "parentId"]) },
  { name: "rename_folder", description: "Renomeia uma pasta sem alterar seus filhos.", inputSchema: objectSchema({ folderId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 100 } }, ["folderId", "name"]) },
  { name: "list_canvases", description: "Lista canvas com paginação. Retorna totalCount e nextOffset; use folderId para restringir a uma pasta.", inputSchema: objectSchema({ folderId: { type: ["string", "null"] }, search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 }, offset: { type: "integer", minimum: 0 }, scope: { type: "string", enum: ["own", "all"] } }) },
  { name: "create_canvas", description: "Cria um canvas persistente. requestId estável torna retries idempotentes.", inputSchema: objectSchema({ name: { type: "string", minLength: 1, maxLength: 255 }, folderId: { type: "string" }, requestId: { type: "string", minLength: 8, maxLength: 200 } }, ["name", "requestId"]) },
  { name: "get_canvas", description: "Lê metadados e resumo de um canvas sem despejar a cena inteira no contexto.", inputSchema: objectSchema({ id: { type: "string" } }, ["id"]) },
  { name: "get_canvas_scene", description: "Lê elements/appState/files completos. Use somente quando realmente precisar editar/refinar.", inputSchema: objectSchema({ id: { type: "string" } }, ["id"]) },
  { name: "describe_canvas", description: "Retorna descrição compacta dos tipos, textos e limites espaciais da cena.", inputSchema: objectSchema({ id: { type: "string" } }, ["id"]) },
  {
    name: "render_presentation",
    description: "Cria uma apresentação ou substitui conscientemente uma cena existente. Atualização exige expectedVersion + confirmReplace=true.",
    inputSchema: objectSchema({
      drawingId: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 }, confirmReplace: { type: "boolean" },
      requestId: { type: "string", minLength: 8, maxLength: 200 }, name: { type: "string" }, folderId: { type: "string" },
      title: { type: "string" }, subtitle: { type: "string" },
      stages: { type: "array", items: objectSchema({ title: { type: "string" }, items: { type: "array", items: { type: "string" } } }, ["title"]) },
      pending: { type: "array", items: objectSchema({ title: { type: "string" }, note: { type: "string" } }, ["title"]) },
      meta: { type: "array", items: objectSchema({ label: { type: "string" }, value: { type: "string" } }, ["label", "value"]) },
    }, ["title", "stages"]),
  },
  { name: "write_scene", description: "Escape hatch: substitui todos os elementos. Exige expectedVersion e confirmação explícita.", inputSchema: objectSchema({ drawingId: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 }, confirmReplace: { const: true }, elements: { type: "array" } }, ["drawingId", "expectedVersion", "confirmReplace", "elements"]) },
  { name: "move_canvas", description: "Move um canvas para uma pasta; folderId null deixa sem pasta.", inputSchema: objectSchema({ drawingId: { type: "string" }, folderId: { type: ["string", "null"] } }, ["drawingId", "folderId"]) },
  { name: "rename_canvas", description: "Renomeia um canvas.", inputSchema: objectSchema({ drawingId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 255 } }, ["drawingId", "name"]) },
  { name: "share_canvas", description: "Compartilha com correspondência EXATA de e-mail. Requer API key com sharing:write.", inputSchema: objectSchema({ drawingId: { type: "string" }, email: { type: "string", format: "email" }, permission: { type: "string", enum: ["view", "edit"] } }, ["drawingId", "email"]) },
  { name: "public_link", description: "Cria somente link público VIEW. Nunca concede edição anônima. Requer sharing:write.", inputSchema: objectSchema({ drawingId: { type: "string" }, expiresAt: { type: ["string", "null"], format: "date-time" } }, ["drawingId"]) },
  { name: "list_sharing", description: "Lista ACLs e link público ativo do canvas.", inputSchema: objectSchema({ drawingId: { type: "string" } }, ["drawingId"]) },
  { name: "revoke_public_link", description: "Revoga um link público pelo shareId retornado por public_link/list_sharing.", inputSchema: objectSchema({ drawingId: { type: "string" }, shareId: { type: "string" } }, ["drawingId", "shareId"]) },
  { name: "add_box", description: "Acrescenta caixa com CAS; falha em conflito em vez de sobrescrever.", inputSchema: objectSchema({ drawingId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, label: { type: "string" }, color: { type: "string", enum: ["blue", "green", "red", "yellow", "purple", "gray"] } }, ["drawingId", "x", "y"]) },
  { name: "add_text", description: "Acrescenta texto com CAS.", inputSchema: objectSchema({ drawingId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, text: { type: "string" }, fontSize: { type: "number", minimum: 8, maximum: 96 } }, ["drawingId", "x", "y", "text"]) },
  { name: "add_arrow", description: "Acrescenta seta por coordenadas com CAS.", inputSchema: objectSchema({ drawingId: { type: "string" }, x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } }, ["drawingId", "x1", "y1", "x2", "y2"]) },
  { name: "add_sticky", description: "Acrescenta bilhete com CAS.", inputSchema: objectSchema({ drawingId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, text: { type: "string" } }, ["drawingId", "x", "y", "text"]) },
];

function toTree(collections) {
  const byId = new Map(collections.map((item) => [item.id, { ...item, children: [] }]));
  const roots = [];
  for (const item of byId.values()) {
    const parent = item.parentId && byId.get(item.parentId);
    if (parent) parent.children.push(item); else roots.push(item);
  }
  const sort = (items) => items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const format = (item, depth = 0) => [
    `${"  ".repeat(depth)}📁 ${item.name} [${item.id}]`,
    ...sort(item.children).flatMap((child) => format(child, depth + 1)),
  ];
  return { roots: sort(roots), text: sort(roots).flatMap((root) => format(root)).join("\n") || "(nenhuma pasta)" };
}

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} é obrigatório`);
  return value.trim();
}

function requireReplace(args) {
  if (args.confirmReplace !== true) throw new Error("confirmReplace=true é obrigatório para substituir uma cena");
  if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1) throw new Error("expectedVersion é obrigatório");
}

function summarize(drawing) {
  const elements = Array.isArray(drawing.elements) ? drawing.elements : [];
  const active = elements.filter((element) => !element?.isDeleted);
  const types = {};
  const labels = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const element of active) {
    types[element.type || "unknown"] = (types[element.type || "unknown"] || 0) + 1;
    const label = typeof element.text === "string" ? element.text.trim() : "";
    if (label && labels.length < 40) labels.push({ id: element.id, text: label.slice(0, 240) });
    const x = Number(element.x), y = Number(element.y), width = Number(element.width), height = Number(element.height);
    if ([x, y, width, height].every(Number.isFinite)) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width); maxY = Math.max(maxY, y + height);
    }
  }
  return {
    id: drawing.id, name: drawing.name, version: drawing.version, collectionId: drawing.collectionId,
    url: drawing.url, elementCount: active.length, types, labels,
    bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } : null,
    fileCount: Object.keys(drawing.files || {}).length,
  };
}

const ok = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (error) => {
  const value = error instanceof ExcalidashHttpError
    ? { error: error.message, status: error.status, code: error.code, details: error.body }
    : { error: error instanceof Error ? error.message : String(error) };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: true };
};

const server = new Server({ name: "noovicrew-excalidash", version: "2.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "whoami": return ok({ user: await client.me(), url: client.url, auth: client.apiKey ? "apiKey" : "cookie" });
      case "list_folders": { const folders = await client.listCollections(); return ok({ tree: toTree(folders).text, folders }); }
      case "ensure_folder_path": return ok(await client.ensureFolderPath(args.path));
      case "create_folder": return ok(await client.createCollection(requireString(args, "name"), args.parentId));
      case "move_folder": return ok(await client.updateCollection(requireString(args, "folderId"), { parentId: args.parentId }));
      case "rename_folder": return ok(await client.updateCollection(requireString(args, "folderId"), { name: requireString(args, "name") }));
      case "list_canvases": return ok(await client.listDrawings({ collectionId: args.folderId, search: args.search, limit: args.limit, offset: args.offset, scope: args.scope }));
      case "create_canvas": return ok(await client.createDrawing({ name: requireString(args, "name"), collectionId: args.folderId, idempotencyKey: requireString(args, "requestId") }));
      case "get_canvas": return ok(summarize(await client.getDrawing(requireString(args, "id"))));
      case "get_canvas_scene": return ok(await client.getDrawing(requireString(args, "id")));
      case "describe_canvas": return ok(summarize(await client.getDrawing(requireString(args, "id"))));
      case "render_presentation": {
        const elements = buildPresentation({ title: args.title, subtitle: args.subtitle, stages: args.stages || [], pending: args.pending || [], meta: args.meta || [] });
        const result = args.drawingId
          ? (requireReplace(args), await client.updateDrawing(args.drawingId, { elements, appState: APPSTATE, expectedVersion: args.expectedVersion }))
          : await client.createDrawing({ name: args.name || args.title, collectionId: args.folderId, elements, appState: APPSTATE, idempotencyKey: requireString(args, "requestId") });
        return ok({ ...result, elementsCount: elements.length });
      }
      case "write_scene": requireReplace(args); return ok(await client.updateDrawing(requireString(args, "drawingId"), { elements: args.elements, expectedVersion: args.expectedVersion }));
      case "move_canvas": return ok(await client.updateDrawing(requireString(args, "drawingId"), { collectionId: args.folderId }));
      case "rename_canvas": return ok(await client.updateDrawing(requireString(args, "drawingId"), { name: requireString(args, "name") }));
      case "share_canvas": return ok(await client.shareDrawing(requireString(args, "drawingId"), requireString(args, "email"), args.permission || "view"));
      case "public_link": return ok(await client.publicLink(requireString(args, "drawingId"), { expiresAt: args.expiresAt ?? null }));
      case "list_sharing": return ok(await client.getSharing(requireString(args, "drawingId")));
      case "revoke_public_link": return ok(await client.revokePublicLink(requireString(args, "drawingId"), requireString(args, "shareId")));
      case "add_box": return ok(await client.appendElements(requireString(args, "drawingId"), boxElements(args.x, args.y, args.width, args.height, args.label, args.color)));
      case "add_text": return ok(await client.appendElements(requireString(args, "drawingId"), textElements(args.x, args.y, requireString(args, "text"), { fontSize: args.fontSize })));
      case "add_arrow": return ok(await client.appendElements(requireString(args, "drawingId"), arrowElements(args.x1, args.y1, args.x2, args.y2)));
      case "add_sticky": return ok(await client.appendElements(requireString(args, "drawingId"), stickyElements(args.x, args.y, requireString(args, "text"))));
      default: throw new Error(`tool desconhecida: ${name}`);
    }
  } catch (error) {
    return failure(error);
  }
});

await server.connect(new StdioServerTransport());
console.error(`[excalidash-mcp] ready url=${client.url} auth=${client.apiKey ? "apiKey" : "cookie"}`);
