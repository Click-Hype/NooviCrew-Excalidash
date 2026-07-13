import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { PrismaClient } from "../generated/client";
import { AuthModeService, BOOTSTRAP_USER_ID } from "../auth/authMode";
import { ACCESS_TOKEN_COOKIE_NAME, parseCookieHeader } from "../auth/cookies";
import {
  getDrawingAccess,
  canEditDrawing,
  canViewDrawing,
  type DrawingPrincipal,
} from "../authz/sharing";

interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  socketId: string;
  isActive: boolean;
}

type RegisterSocketHandlersDeps = {
  io: Server;
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
};

const MAX_DRAWING_ID_LENGTH = 200;
const MAX_SOCKET_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_ELEMENTS_PER_UPDATE = 2_000;
const MAX_FILES_PER_UPDATE = 200;
const MAX_ELEMENT_ORDER_LENGTH = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDrawingId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_DRAWING_ID_LENGTH
    ? trimmed
    : null;
};

const isBoundedPayload = (value: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SOCKET_EVENT_BYTES;
  } catch {
    return false;
  }
};

const isValidElementUpdate = (
  value: unknown,
): value is Record<string, unknown> & { drawingId: string } => {
  if (!isRecord(value) || !parseDrawingId(value.drawingId)) return false;
  if (!isBoundedPayload(value)) return false;
  if (
    value.elements !== undefined &&
    (!Array.isArray(value.elements) || value.elements.length > MAX_ELEMENTS_PER_UPDATE)
  ) {
    return false;
  }
  if (
    value.files !== undefined &&
    (!isRecord(value.files) || Object.keys(value.files).length > MAX_FILES_PER_UPDATE)
  ) {
    return false;
  }
  if (
    value.elementOrder !== undefined &&
    (!Array.isArray(value.elementOrder) ||
      value.elementOrder.length > MAX_ELEMENT_ORDER_LENGTH ||
      !value.elementOrder.every(
        (entry) => typeof entry === "string" && entry.length <= 200,
      ))
  ) {
    return false;
  }
  return true;
};

export const registerSocketHandlers = ({
  io,
  prisma,
  authModeService,
  jwtSecret,
}: RegisterSocketHandlersDeps) => {
  const roomUsers = new Map<string, User[]>();
  const socketPrincipalMap = new Map<string, DrawingPrincipal>();

  const toPresenceName = (value: unknown): string => {
    if (typeof value !== "string") return "User";
    const trimmed = value.trim().slice(0, 120);
    return trimmed.length > 0 ? trimmed : "User";
  };

  const toPresenceInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.trim().slice(0, 2).toUpperCase() || "U";
  };

  const toPresenceColor = (value: unknown): string => {
    if (typeof value !== "string") return "#4f46e5";
    const trimmed = value.trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : "#4f46e5";
  };

  const getSocketAuthUserId = async (token?: string): Promise<string | null> => {
    if (!(await authModeService.getAuthEnabled())) return BOOTSTRAP_USER_ID;
    if (!token) return null;
    try {
      const decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      if (
        typeof decoded.userId !== "string" ||
        typeof decoded.email !== "string" ||
        decoded.type !== "access"
      ) {
        return null;
      }
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, isActive: true },
      });
      return user?.isActive ? user.id : null;
    } catch {
      return null;
    }
  };

  io.use(async (socket, next) => {
    try {
      const tokenFromAuth = socket.handshake.auth?.token as string | undefined;
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      const cookieValue = cookies[ACCESS_TOKEN_COOKIE_NAME];
      const tokenFromCookie =
        typeof cookieValue === "string" && cookieValue.trim() ? cookieValue : undefined;
      const authEnabled = await authModeService.getAuthEnabled();
      const userId = await getSocketAuthUserId(tokenFromAuth || tokenFromCookie);
      if (userId) {
        socketPrincipalMap.set(socket.id, { kind: "user", userId });
        return next();
      }
      // Anonymous sockets may still join a drawing with an active link policy.
      if (authEnabled) return next();
      return next(new Error("Authentication required"));
    } catch {
      return next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const principal = socketPrincipalMap.get(socket.id) || null;
    const joinedDrawingIds = new Set<string>();
    const accessCache = new Map<
      string,
      { access: "view" | "edit" | "owner"; checkedAtMs: number }
    >();
    const ACCESS_CACHE_TTL_MS = 1_500;

    const getCachedOrFreshAccess = async (
      drawingId: string,
    ): Promise<"view" | "edit" | "owner" | null> => {
      const cached = accessCache.get(drawingId);
      const now = Date.now();
      if (cached && now - cached.checkedAtMs < ACCESS_CACHE_TTL_MS) {
        return cached.access;
      }
      const access = await getDrawingAccess({ prisma, principal, drawingId });
      if (!canViewDrawing(access)) {
        accessCache.delete(drawingId);
        return null;
      }
      accessCache.set(drawingId, { access, checkedAtMs: now });
      return access;
    };

    const removePresence = (drawingId: string) => {
      const roomId = `drawing_${drawingId}`;
      const remaining = (roomUsers.get(roomId) || []).filter(
        (user) => user.socketId !== socket.id,
      );
      if (remaining.length) roomUsers.set(roomId, remaining);
      else roomUsers.delete(roomId);
      io.to(roomId).emit("presence-update", remaining);
    };

    const evictFromDrawing = async (drawingId: string) => {
      joinedDrawingIds.delete(drawingId);
      accessCache.delete(drawingId);
      removePresence(drawingId);
      await socket.leave(`drawing_${drawingId}`);
      socket.emit("access-revoked", { drawingId });
      socket.emit("error", { message: "You do not have access to this drawing" });
    };

    let revalidationInFlight = false;
    const revalidationTimer = setInterval(async () => {
      if (revalidationInFlight || joinedDrawingIds.size === 0) return;
      revalidationInFlight = true;
      try {
        if (principal?.kind === "user" && principal.userId !== BOOTSTRAP_USER_ID) {
          const account = await prisma.user.findUnique({
            where: { id: principal.userId },
            select: { isActive: true },
          });
          if (!account?.isActive) {
            socket.emit("access-revoked", { reason: "account_inactive" });
            socket.disconnect(true);
            return;
          }
        }
        for (const drawingId of Array.from(joinedDrawingIds)) {
          accessCache.delete(drawingId);
          if (!(await getCachedOrFreshAccess(drawingId))) {
            await evictFromDrawing(drawingId);
          }
        }
      } catch (error) {
        console.error("Socket access revalidation failed:", error);
      } finally {
        revalidationInFlight = false;
      }
    }, 2_000);
    revalidationTimer.unref?.();

    socket.on("join-room", async (payload: unknown, ack?: (value: unknown) => void) => {
      try {
        if (!isRecord(payload) || !isRecord(payload.user) || !isBoundedPayload(payload)) {
          socket.emit("error", { message: "Invalid join-room payload" });
          return;
        }
        const drawingId = parseDrawingId(payload.drawingId);
        if (!drawingId || !(await getCachedOrFreshAccess(drawingId))) {
          socket.emit("error", { message: "You do not have access to this drawing" });
          return;
        }
        const user = payload.user;
        const roomId = `drawing_${drawingId}`;
        await socket.join(roomId);
        joinedDrawingIds.add(drawingId);

        let trustedUserId =
          typeof user.id === "string" && user.id.trim()
            ? user.id.trim().slice(0, 200)
            : socket.id;
        let trustedName = toPresenceName(user.name);
        if (!principal) {
          trustedUserId = `anon:${socket.id}`.slice(0, 200);
        } else if (principal.userId !== BOOTSTRAP_USER_ID) {
          const account = await prisma.user.findUnique({
            where: { id: principal.userId },
            select: { id: true, name: true },
          });
          if (account) {
            trustedUserId = account.id;
            trustedName = toPresenceName(account.name);
          }
        }
        const newUser: User = {
          id: trustedUserId,
          name: trustedName,
          initials: toPresenceInitials(trustedName),
          color: toPresenceColor(user.color),
          socketId: socket.id,
          isActive: true,
        };
        const users = (roomUsers.get(roomId) || []).filter(
          (entry) => entry.socketId !== socket.id,
        );
        users.push(newUser);
        roomUsers.set(roomId, users);
        io.to(roomId).emit("presence-update", users);
        if (typeof ack === "function") {
          ack({
            user: {
              id: newUser.id,
              name: newUser.name,
              initials: newUser.initials,
              color: newUser.color,
            },
          });
        }
      } catch (error) {
        console.error("Error in join-room handler:", error);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    socket.on("cursor-move", async (data: unknown) => {
      if (!isRecord(data) || !isRecord(data.pointer) || !isBoundedPayload(data)) return;
      const drawingId = parseDrawingId(data.drawingId);
      const x = data.pointer.x;
      const y = data.pointer.y;
      if (
        !drawingId ||
        !joinedDrawingIds.has(drawingId) ||
        typeof x !== "number" ||
        !Number.isFinite(x) ||
        typeof y !== "number" ||
        !Number.isFinite(y)
      ) {
        return;
      }
      if (!(await getCachedOrFreshAccess(drawingId))) {
        await evictFromDrawing(drawingId);
        return;
      }
      const roomId = `drawing_${drawingId}`;
      const self = (roomUsers.get(roomId) || []).find(
        (user) => user.socketId === socket.id,
      );
      if (!self) return;
      socket.volatile.to(roomId).emit("cursor-move", {
        drawingId,
        pointer: { x, y },
        button: typeof data.button === "string" ? data.button.slice(0, 20) : "up",
        userId: self.id,
        username: self.name,
        color: self.color,
      });
    });

    socket.on("element-update", async (data: unknown) => {
      if (!isValidElementUpdate(data)) {
        socket.emit("error", { message: "Invalid element-update payload" });
        return;
      }
      const drawingId = parseDrawingId(data.drawingId)!;
      if (!joinedDrawingIds.has(drawingId)) return;
      const access = await getCachedOrFreshAccess(drawingId);
      if (!access || !canEditDrawing(access)) {
        if (!access) await evictFromDrawing(drawingId);
        else socket.emit("error", { message: "Read-only access: cannot edit this drawing" });
        return;
      }
      socket.to(`drawing_${drawingId}`).emit("element-update", {
        drawingId,
        elements: Array.isArray(data.elements) ? data.elements : [],
        files: isRecord(data.files) ? data.files : undefined,
        elementOrder: Array.isArray(data.elementOrder) ? data.elementOrder : undefined,
      });
    });

    socket.on("user-activity", async (payload: unknown) => {
      if (!isRecord(payload) || typeof payload.isActive !== "boolean") return;
      const drawingId = parseDrawingId(payload.drawingId);
      if (!drawingId || !joinedDrawingIds.has(drawingId)) return;
      if (!(await getCachedOrFreshAccess(drawingId))) {
        await evictFromDrawing(drawingId);
        return;
      }
      const roomId = `drawing_${drawingId}`;
      const users = roomUsers.get(roomId);
      const user = users?.find((entry) => entry.socketId === socket.id);
      if (user && users) {
        user.isActive = payload.isActive;
        io.to(roomId).emit("presence-update", users);
      }
    });

    socket.on("disconnect", () => {
      clearInterval(revalidationTimer);
      socketPrincipalMap.delete(socket.id);
      for (const drawingId of joinedDrawingIds) removePresence(drawingId);
      joinedDrawingIds.clear();
    });
  });
};
