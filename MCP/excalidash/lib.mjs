// Excalidash client + Excalidraw scene builder — NooviCrew
// Cliente REST autenticado (cookie + CSRF) para o backend Excalidash multi-canvas,
// e um auto-layout de "apresentação" (fluxo + trilha + pendências) em elementos Excalidraw.
// Usado pelo MCP (mcp.mjs) e pela CLI (cli.mjs). ESM puro, Node >=18 (fetch nativo).

const DEFAULT_URL = process.env.EXCALIDASH_URL?.trim();
const DEFAULT_TIMEOUT_MS = 15_000;

export class ExcalidashHttpError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = "ExcalidashHttpError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const normalizeFolderPath = (path) => {
  const parts = Array.isArray(path)
    ? path
    : String(path || "").split(/\s*(?:\/|›|>)\s*/);
  return parts.map((part) => String(part).trim()).filter(Boolean);
};

const collectionKey = (name, parentId) =>
  `${parentId ?? "<root>"}\u0000${String(name).trim().toLocaleLowerCase("pt-BR")}`;

export function decorateCollectionPaths(collections) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const resolve = (collection, seen = new Set()) => {
    if (!collection || seen.has(collection.id)) return [collection?.name || "?"];
    seen.add(collection.id);
    const parent = collection.parentId ? byId.get(collection.parentId) : null;
    return parent ? [...resolve(parent, seen), collection.name] : [collection.name];
  };
  return collections.map((collection) => {
    const pathParts = resolve(collection);
    return { ...collection, pathParts, path: pathParts.join(" › ") };
  });
}

// ---------------------------------------------------------------- HTTP client
export class Excalidash {
  constructor({
    url = DEFAULT_URL,
    apiKey = process.env.EXCALIDASH_API_KEY,
    email = process.env.EXCALIDASH_EMAIL,
    password = process.env.EXCALIDASH_PASSWORD,
    timeoutMs = Number(process.env.EXCALIDASH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (!url) {
      throw new Error("EXCALIDASH_URL deve ser definido explicitamente; não há fallback para produção");
    }
    this.url = url.replace(/\/$/, "");
    this.apiKey = apiKey?.trim() || null;
    this.email = email;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.cookies = new Map();
    this.csrf = null;
    this.loggedIn = false;
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async _fetch(path, { method = "GET", body, headers = {} } = {}) {
    const h = { ...headers };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    const cookie = this._cookieHeader();
    if (cookie) h["cookie"] = cookie;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.url + path, {
        method,
        headers: h,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new ExcalidashHttpError(`${method} ${path} excedeu ${this.timeoutMs}ms`, {
          code: "TIMEOUT",
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookies) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
    return res;
  }

  async _getCsrf() {
    if (this.apiKey) return null;
    const r = await this._fetch("/api/csrf-token");
    if (!r.ok) throw await this._responseError(r, "GET", "/api/csrf-token");
    const j = await r.json();
    this.csrf = j.token;
    return j.token;
  }

  async login() {
    if (this.apiKey) {
      this.loggedIn = true;
      return this.me();
    }
    if (!this.email || !this.password) throw new Error("EXCALIDASH_EMAIL/EXCALIDASH_PASSWORD não definidos");
    await this._getCsrf();
    const r = await this._fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": this.csrf, origin: this.url },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!r.ok) throw new Error(`login falhou (${r.status}): ${(await r.text()).slice(0, 200)}`);
    this.loggedIn = true;
    return (await r.json()).user;
  }

  async _ensure() {
    if (!this.apiKey && !this.loggedIn) await this.login();
  }

  async _responseError(response, method, path) {
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 500); }
    const code = body && typeof body === "object" ? body.code || body.error : undefined;
    const detail = body && typeof body === "object"
      ? body.message || body.error
      : String(body || "");
    return new ExcalidashHttpError(
      `${method} ${path} → ${response.status}${detail ? `: ${detail}` : ""}`,
      { status: response.status, code, body },
    );
  }

  // GET autenticado (re-login em 401)
  async _get(path) {
    await this._ensure();
    let r = await this._fetch(path);
    if (!this.apiKey && r.status === 401) {
      this.loggedIn = false;
      await this.login();
      r = await this._fetch(path);
    }
    if (!r.ok) throw await this._responseError(r, "GET", path);
    return r.json();
  }

  // Write autenticado (POST/PUT/DELETE) com CSRF fresco + retry em 401
  async _write(method, path, payload, { headers = {} } = {}) {
    await this._ensure();
    const doIt = async () => {
      await this._getCsrf();
      return this._fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.csrf ? { "x-csrf-token": this.csrf, origin: this.url } : {}),
          ...headers,
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    };
    let r = await doIt();
    if (!this.apiKey && r.status === 401) {
      this.loggedIn = false;
      await this.login();
      r = await doIt();
    }
    if (!r.ok) throw await this._responseError(r, method, path);
    return r.status === 204 ? { ok: true } : r.json();
  }

  // ---- API de alto nível ----
  async me() { return (await this._get("/api/auth/me")).user; }

  async listCollections() {
    const cols = await this._get("/api/collections");
    return decorateCollectionPaths(cols.filter((c) => c.id !== "trash").map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId ?? null,
      isOwner: c.isOwner,
      isShared: c.isShared,
      sharedRole: c.sharedRole ?? null,
    })));
  }
  async createCollection(name, parentId) {
    const c = await this._write("POST", "/api/collections", parentId ? { name, parentId } : { name });
    return { id: c.id, name: c.name, parentId: c.parentId ?? parentId ?? null };
  }
  async deleteCollection(id) { return this._write("DELETE", `/api/collections/${id}`); }

  async ensureFolderPath(path) {
    const parts = normalizeFolderPath(path);
    if (parts.length === 0) throw new Error("path precisa conter ao menos uma pasta");
    let collections = await this.listCollections();
    let parentId = null;
    const resolved = [];
    for (const name of parts) {
      const matches = collections.filter((collection) =>
        collectionKey(collection.name, collection.parentId) === collectionKey(name, parentId));
      if (matches.length > 1) {
        throw new Error(`pasta ambígua em ${[...resolved.map((item) => item.name), name].join(" › ")}`);
      }
      let folder = matches[0];
      if (!folder) {
        folder = await this.createCollection(name, parentId);
        collections = [...collections, folder];
      }
      resolved.push(folder);
      parentId = folder.id;
    }
    return {
      folder: resolved.at(-1),
      path: resolved.map((item) => item.name).join(" › "),
      createdOrResolved: resolved,
    };
  }

  async listDrawings(options = {}) {
    if (typeof options === "string") options = { collectionId: options };
    const { collectionId, search, limit = 50, offset = 0, scope } = options;
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (collectionId !== undefined) params.set("collectionId", collectionId === null ? "null" : collectionId);
    if (search) params.set("search", search);
    if (scope === "all") params.set("scope", "all");
    const res = await this._get(`/api/drawings?${params}`);
    const arr = Array.isArray(res) ? res : res.drawings || [];
    return {
      canvases: arr.map((d) => ({
        id: d.id,
        name: d.name,
        collectionId: d.collectionId,
        version: d.version,
        creatorName: d.creatorName ?? null,
        creatorEmail: d.creatorEmail ?? null,
        url: `${this.url}/editor/${d.id}`,
        updatedAt: d.updatedAt,
      })),
      totalCount: Number(res.totalCount ?? arr.length),
      limit,
      offset,
      nextOffset: offset + arr.length < Number(res.totalCount ?? arr.length) ? offset + arr.length : null,
    };
  }
  async getDrawing(id) {
    const d = await this._get(`/api/drawings/${id}`);
    return {
      id: d.id,
      name: d.name,
      collectionId: d.collectionId,
      version: d.version,
      accessLevel: d.accessLevel,
      elements: parseMaybe(d.elements),
      appState: parseMaybe(d.appState),
      files: parseMaybe(d.files),
      updatedAt: d.updatedAt,
      url: `${this.url}/editor/${d.id}`,
    };
  }
  async createDrawing({ name, collectionId, elements = [], appState = {}, files = {}, idempotencyKey }) {
    const d = await this._write(
      "POST",
      "/api/drawings",
      { name, collectionId: collectionId || null, elements, appState, files },
      { headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {} },
    );
    return { id: d.id, name: d.name, version: d.version, url: `${this.url}/editor/${d.id}` };
  }
  async updateDrawing(id, { name, collectionId, elements, appState, files, expectedVersion } = {}) {
    const body = {};
    if (name !== undefined) body.name = name;
    if (collectionId !== undefined) body.collectionId = collectionId;
    if (elements !== undefined) body.elements = elements;
    if (appState !== undefined) body.appState = appState;
    if (files !== undefined) body.files = files;
    const sceneUpdate = elements !== undefined || appState !== undefined || files !== undefined;
    if (sceneUpdate) {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error("expectedVersion é obrigatório para alterar a cena");
      }
      body.version = expectedVersion;
    }
    const d = await this._write("PUT", `/api/drawings/${id}`, body);
    return { id: d.id, name: d.name, version: d.version, url: `${this.url}/editor/${d.id}` };
  }

  // Renomeia/move uma pasta (parentId=null tira do aninhamento). Anti-ciclo é validado no backend.
  async updateCollection(id, { name, parentId } = {}) {
    const body = {};
    if (name !== undefined) body.name = name;
    if (parentId !== undefined) body.parentId = parentId;
    return this._write("PUT", `/api/collections/${id}`, body);
  }

  // Compartilha um canvas com uma pessoa pelo e-mail (permission: "view" | "edit").
  async shareDrawing(drawingId, email, permission = "view") {
    const matches = await this._get(`/api/drawings/${drawingId}/share-resolve?q=${encodeURIComponent(email)}`);
    const list = Array.isArray(matches) ? matches : matches.users || [];
    const user = list.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (!user) throw new Error(`correspondência exata não encontrada para "${email}"`);
    await this._write("POST", `/api/drawings/${drawingId}/permissions`, { granteeUserId: user.id, permission });
    return { drawingId, sharedWith: user.email, permission };
  }

  // Gera um LINK PÚBLICO view-only (qualquer pessoa com o link vê, sem conta).
  // O acesso é por drawing id + política ativa (link = /shared/<id>, sem token na URL).
  async publicLink(drawingId, { expiresAt = null } = {}) {
    const result = await this._write("POST", `/api/drawings/${drawingId}/link-shares`, {
      permission: "view",
      expiresAt,
    });
    return { drawingId, permission: "view", url: `${this.url}/shared/${drawingId}`, share: result.share };
  }

  async getSharing(drawingId) { return this._get(`/api/drawings/${drawingId}/sharing`); }
  async revokePublicLink(drawingId, shareId) {
    return this._write("DELETE", `/api/drawings/${drawingId}/link-shares/${shareId}`);
  }

  // Acrescenta elementos a um canvas SEM apagar os existentes (get + concat + put).
  async appendElements(drawingId, newElements) {
    const cur = await this.getDrawing(drawingId);
    const elements = [...(Array.isArray(cur.elements) ? cur.elements : []), ...newElements];
    const updated = await this.updateDrawing(drawingId, { elements, expectedVersion: cur.version });
    return { id: drawingId, added: newElements.length, total: elements.length, version: updated.version, url: cur.url };
  }

  // Garante uma coleção pelo nome (cria se não existir) — organização por projeto/cliente
  async ensureCollection(name) {
    return (await this.ensureFolderPath([name])).folder;
  }
}

function parseMaybe(v) { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } }

// ------------------------------------------------- Excalidraw element builders
let _idc = 0;
const rid = () => `nc-${Date.now().toString(36)}-${(_idc++).toString(36)}`;
const seed = () => Math.floor(Math.random() * 2 ** 31);

const PALETTE = {
  ink: "#1e1e1e", sub: "#5c5c5c",
  stageBg: "#e7f0ff", stageStroke: "#3b6fd4",
  startBg: "#e6f7ec", startStroke: "#2f9e51",
  endBg: "#fdecef", endStroke: "#d1435b",
  noteBg: "#fff6d6", noteStroke: "#e0b83a",
  metaBg: "#f2effc", metaStroke: "#7b61c9",
  arrow: "#3b3b3b",
};

function baseEl(type, x, y, w, h, extra = {}) {
  return {
    id: rid(), type, x, y, width: w, height: h, angle: 0,
    strokeColor: PALETTE.ink, backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 1.5, strokeStyle: "solid", roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: seed(), version: 1,
    versionNonce: seed(), isDeleted: false, boundElements: null, updated: Date.now(),
    link: null, locked: false, ...extra,
  };
}

function rect(x, y, w, h, { bg = "transparent", stroke = PALETTE.ink, rounded = true } = {}) {
  return baseEl("rectangle", x, y, w, h, { backgroundColor: bg, strokeColor: stroke, roundness: rounded ? { type: 3 } : null });
}

const CHAR_W = 0.58; // aproximação de largura por caractere relativa ao fontSize
function wrap(text, maxWidth, fontSize) {
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * CHAR_W)));
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > maxChars) { if (line) out.push(line); line = word; }
      else line = (line ? line + " " : "") + word;
    }
    out.push(line);
  }
  return out;
}

function text(x, y, str, { fontSize = 16, color = PALETTE.ink, maxWidth = 600, align = "left", bold = false } = {}) {
  const lines = wrap(str, maxWidth, fontSize);
  const lineHeight = 1.25;
  const h = Math.ceil(lines.length * fontSize * lineHeight);
  const w = Math.min(maxWidth, Math.max(...lines.map((l) => l.length)) * fontSize * CHAR_W + 4);
  const body = lines.join("\n");
  return baseEl("text", x, y, w, h, {
    strokeColor: color, text: body, originalText: body, fontSize,
    fontFamily: bold ? 2 : 1, textAlign: align, verticalAlign: "top",
    containerId: null, lineHeight, baseline: Math.round(fontSize * 0.9),
  });
}

// altura de um bloco de texto (mesma lógica de wrap do render), p/ dimensionar caixas
function textHeight(str, maxWidth, fontSize) {
  return Math.ceil(wrap(str, maxWidth, fontSize).length * fontSize * 1.25);
}

function arrow(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return baseEl("arrow", x1, y1, Math.abs(dx) || 1, Math.abs(dy) || 1, {
    strokeColor: PALETTE.arrow, points: [[0, 0], [dx, dy]], lastCommittedPoint: null,
    startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow",
  });
}

// Constrói a cena de apresentação: título, lane de estágios (fluxo/trilha, serpentina),
// painel de pendências e um card de meta (persona/horário). Retorna array de elementos.
export function buildPresentation({ title, subtitle, stages = [], pending = [], meta = [] }) {
  const els = [];
  const X0 = 60, Y0 = 50;
  const W = 250, HGAP = 70, VGAP = 95, PER_ROW = 4;
  const TPAD = 12, TITLE_FS = 15, ITEM_FS = 12;
  // altura uniforme dos estágios = maior conteúdo (garante texto DENTRO da caixa)
  const _stageH = stages.map((s) => {
    const th = textHeight(`00. ${s.title}`, W - 2 * TPAD, TITLE_FS);
    const items = (s.items || []).map((it) => `• ${it}`).join("\n");
    const ih = items ? textHeight(items, W - 2 * TPAD, ITEM_FS) : 0;
    return TPAD + th + (ih ? 8 + ih : 0) + TPAD;
  });
  const H = Math.max(150, ...(_stageH.length ? _stageH : [150]));

  // cabeçalho: título + subtítulo (empilhados sem sobrepor, mesmo com título de 2 linhas)
  const headerMax = X0 + PER_ROW * (W + HGAP) - (W + 30) - 40 - X0;
  let headerBottom = Y0;
  if (title) { const t = text(X0, Y0, title, { fontSize: 28, maxWidth: headerMax, bold: true }); els.push(t); headerBottom = t.y + t.height; }
  if (subtitle) { const s = text(X0, headerBottom + 8, subtitle, { fontSize: 15, color: PALETTE.sub, maxWidth: headerMax }); els.push(s); headerBottom = s.y + s.height; }

  // meta card (topo-direita), dimensionado ao conteúdo
  const metaW = W + 30;
  const metaX = X0 + PER_ROW * (W + HGAP) - metaW;
  let metaBottom = Y0;
  if (meta.length) {
    const header = text(metaX + 14, Y0 + 12, "Contexto", { fontSize: 14, color: PALETTE.metaStroke, bold: true });
    let yy = Y0 + 40;
    const placed = [];
    for (const m of meta) { const ln = text(metaX + 14, yy, `${m.label}: ${m.value}`, { fontSize: 12, color: PALETTE.ink, maxWidth: metaW - 28 }); placed.push(ln); yy += ln.height + 6; }
    const mh = yy - Y0 + 8;
    els.push(rect(metaX, Y0, metaW, mh, { bg: PALETTE.metaBg, stroke: PALETTE.metaStroke }), header, ...placed);
    metaBottom = Y0 + mh;
  }

  // lane de estágios (serpentina) — começa abaixo do cabeçalho e do card de contexto
  const startY = Math.max(headerBottom, metaBottom) + 34;
  const pos = [];
  stages.forEach((s, i) => {
    const row = Math.floor(i / PER_ROW);
    const colInRow = i % PER_ROW;
    const physCol = row % 2 === 0 ? colInRow : PER_ROW - 1 - colInRow;
    const x = X0 + physCol * (W + HGAP);
    const y = startY + row * (H + VGAP);
    pos.push({ x, y, row });
    const isStart = i === 0, isEnd = i === stages.length - 1;
    const bg = isStart ? PALETTE.startBg : isEnd ? PALETTE.endBg : PALETTE.stageBg;
    const st = isStart ? PALETTE.startStroke : isEnd ? PALETTE.endStroke : PALETTE.stageStroke;
    els.push(rect(x, y, W, H, { bg, stroke: st }));
    const titleH = textHeight(`${i + 1}. ${s.title}`, W - 28, TITLE_FS);
    els.push(text(x + 14, y + 12, `${i + 1}. ${s.title}`, { fontSize: TITLE_FS, color: st, bold: true, maxWidth: W - 28 }));
    const items = (s.items || []).map((it) => `• ${it}`).join("\n");
    if (items) els.push(text(x + 14, y + 12 + titleH + 8, items, { fontSize: ITEM_FS, color: PALETTE.ink, maxWidth: W - 28 }));
  });

  // setas entre estágios consecutivos
  for (let i = 0; i < pos.length - 1; i++) {
    const a = pos[i], b = pos[i + 1];
    if (a.row === b.row) {
      const leftToRight = b.x > a.x;
      const ax = leftToRight ? a.x + W : a.x;
      const bx = leftToRight ? b.x : b.x + W;
      els.push(arrow(ax, a.y + H / 2, bx, b.y + H / 2));
    } else {
      // transição de linha: desce da base do atual para o topo do próximo
      els.push(arrow(a.x + W / 2, a.y + H, b.x + W / 2, b.y));
    }
  }

  // painel de pendências
  const lastRow = pos.length ? pos[pos.length - 1].row : 0;
  let py = startY + (lastRow + 1) * (H + VGAP) + 10;
  if (pending.length) {
    els.push(text(X0, py, `Falta coletar — ${pending.length} itens pendentes`, { fontSize: 20, color: PALETTE.endStroke, bold: true, maxWidth: 1000 }));
    py += 40;
    const NW = 300, NG = 22, NCOL = 3, NPAD = 10;
    // altura uniforme das notas = maior conteúdo (título pode quebrar em 2+ linhas)
    const _noteH = pending.map((p) => {
      const th = textHeight(`00. ${p.title}`, NW - 24, 13);
      const nh = p.note ? textHeight(p.note, NW - 24, 10) : 0;
      return NPAD + th + (nh ? 6 + nh : 0) + NPAD;
    });
    const NH = Math.max(96, ...(_noteH.length ? _noteH : [96]));
    pending.forEach((p, i) => {
      const c = i % NCOL, r = Math.floor(i / NCOL);
      const x = X0 + c * (NW + NG);
      const y = py + r * (NH + NG);
      els.push(rect(x, y, NW, NH, { bg: PALETTE.noteBg, stroke: PALETTE.noteStroke }));
      const th = textHeight(`${i + 1}. ${p.title}`, NW - 24, 13);
      els.push(text(x + 12, y + NPAD, `${i + 1}. ${p.title}`, { fontSize: 13, color: PALETTE.ink, bold: true, maxWidth: NW - 24 }));
      if (p.note) els.push(text(x + 12, y + NPAD + th + 6, p.note, { fontSize: 10, color: PALETTE.sub, maxWidth: NW - 24 }));
    });
  }

  return els;
}

// ---- Builders de desenho livre (retornam array de elementos p/ appendElements) ----
const COLORS = {
  blue: { bg: "#e7f0ff", stroke: "#3b6fd4" }, green: { bg: "#e6f7ec", stroke: "#2f9e51" },
  red: { bg: "#fdecef", stroke: "#d1435b" }, yellow: { bg: "#fff6d6", stroke: "#e0b83a" },
  purple: { bg: "#f2effc", stroke: "#7b61c9" }, gray: { bg: "#f1f3f5", stroke: "#868e96" },
};
/** Caixa rotulada (retângulo + texto centralizado). color: blue|green|red|yellow|purple|gray */
export function boxElements(x, y, w = 220, h = 90, label = "", color = "blue") {
  const c = COLORS[color] || COLORS.blue;
  const pad = 12, fs = 15;
  const th = label ? textHeight(label, w - 2 * pad, fs) : 0;
  const H = Math.max(h, th + 2 * pad);            // caixa cresce p/ o texto nunca vazar
  const els = [rect(x, y, w, H, { bg: c.bg, stroke: c.stroke })];
  if (label) els.push(text(x + pad, y + Math.max(pad, (H - th) / 2), label, { fontSize: fs, color: c.stroke, bold: true, maxWidth: w - 2 * pad }));
  return els;
}
/** Texto solto. */
export function textElements(x, y, str, { fontSize = 16, color = PALETTE.ink, maxWidth = 500 } = {}) {
  return [text(x, y, str, { fontSize, color, maxWidth })];
}
/** Seta entre dois pontos. */
export function arrowElements(x1, y1, x2, y2) {
  return [arrow(x1, y1, x2, y2)];
}
/** Sticky note (bilhete amarelo com texto). */
export function stickyElements(x, y, str, w = 220, h = 120) {
  return [rect(x, y, w, h, { bg: PALETTE.noteBg, stroke: PALETTE.noteStroke }), text(x + 12, y + 12, str, { fontSize: 13, color: PALETTE.ink, maxWidth: w - 24 })];
}

export const APPSTATE = { viewBackgroundColor: "#ffffff", gridSize: null };
