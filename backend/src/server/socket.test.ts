import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSocketHandlers } from "./socket";

const buildHarness = () => {
  let middleware: ((socket: any, next: (error?: Error) => void) => void) | null =
    null;
  let connectionHandler: ((socket: any) => void) | null = null;
  const roomEmit = vi.fn();
  const io = {
    use: vi.fn((handler) => {
      middleware = handler;
    }),
    on: vi.fn((event, handler) => {
      if (event === "connection") connectionHandler = handler;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
  };
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket = {
    id: "socket-1",
    handshake: { auth: {}, headers: {} },
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    volatile: { to: vi.fn(() => ({ emit: vi.fn() })) },
  };
  let linkPermission: "view" | "edit" | null = "view";
  const prisma = {
    drawingLinkShare: {
      findFirst: vi.fn(async () =>
        linkPermission ? { permission: linkPermission } : null,
      ),
    },
    user: { findUnique: vi.fn() },
  };
  const authModeService = {
    getAuthEnabled: vi.fn().mockResolvedValue(true),
  };

  registerSocketHandlers({
    io: io as any,
    prisma: prisma as any,
    authModeService: authModeService as any,
    jwtSecret: "test-secret",
  });

  return {
    io,
    socket,
    handlers,
    prisma,
    setLinkPermission: (value: "view" | "edit" | null) => {
      linkPermission = value;
    },
    connect: async () => {
      const next = vi.fn();
      await middleware!(socket, next);
      expect(next).toHaveBeenCalledWith();
      connectionHandler!(socket);
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("socket authorization hardening", () => {
  it("rejects oversized or malformed collaboration payloads", async () => {
    const harness = buildHarness();
    await harness.connect();

    await harness.handlers.get("join-room")?.({
      drawingId: "drawing-1",
      user: { id: "guest", name: "Guest", color: "#fff" },
    });
    await harness.handlers.get("element-update")?.({
      drawingId: "drawing-1",
      elements: Array.from({ length: 2_001 }, (_, id) => ({ id })),
    });

    expect(harness.socket.emit).toHaveBeenCalledWith("error", {
      message: "Invalid element-update payload",
    });
    await harness.handlers.get("disconnect")?.();
  });

  it("evicts a connected anonymous viewer after its link is revoked", async () => {
    vi.useFakeTimers();
    const harness = buildHarness();
    await harness.connect();
    await harness.handlers.get("join-room")?.({
      drawingId: "drawing-1",
      user: { id: "untrusted", name: "Guest", color: "#fff" },
    });
    expect(harness.socket.join).toHaveBeenCalledWith("drawing_drawing-1");

    harness.setLinkPermission(null);
    await vi.advanceTimersByTimeAsync(2_100);

    expect(harness.socket.leave).toHaveBeenCalledWith("drawing_drawing-1");
    expect(harness.socket.emit).toHaveBeenCalledWith("access-revoked", {
      drawingId: "drawing-1",
    });
    await harness.handlers.get("disconnect")?.();
  });
});
