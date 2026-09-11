import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: mocks.requireSession };
});
vi.mock("@/server/simulator/outreach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/simulator/outreach")>();
  return { ...actual, generateSimulatedFirstOutreach: mocks.generate };
});

import { UnauthorizedError } from "@/lib/auth/session";
import { POST } from "@/app/api/simulator/conversations/[id]/outreach/route";
import { SimulatedOutreachError } from "@/server/simulator/outreach";

const params = { params: Promise.resolve({ id: "cv_test" }) };
const message = {
  id: "msg_outreach",
  organizationId: "org_active",
  conversationId: "cv_test",
  waMessageId: null,
  direction: "out",
  type: "text",
  text: "Hola Lucía",
  status: "sent",
  error: null,
  aiGenerated: true,
  origin: "ai",
  waTimestamp: null,
  createdAt: new Date("2026-09-11T10:00:00.000Z"),
};

function request(body?: string): Request {
  return new Request(
    "http://localhost/api/simulator/conversations/cv_test/outreach",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
    }
  );
}

describe("POST /api/simulator/conversations/[id]/outreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "user_1",
      organizationId: "org_active",
      role: "owner",
    });
    mocks.generate.mockResolvedValue(message);
  });

  it.each([
    new UnauthorizedError(),
    new UnauthorizedError("Sesión sin organización activa"),
  ])("devuelve 401 sin sesión u organización", async (error) => {
    mocks.requireSession.mockRejectedValue(error);

    const response = await POST(request(), params);

    expect(response.status).toBe(401);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each([undefined, "{}"])("acepta body vacío o objeto vacío: %s", async (body) => {
    const response = await POST(request(body), params);

    expect(response.status).toBe(201);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledWith("org_active", "cv_test");
    expect(await response.json()).toEqual({
      message: {
        id: "msg_outreach",
        conversationId: "cv_test",
        direction: "out",
        type: "text",
        text: "Hola Lucía",
        status: "sent",
        error: null,
        aiGenerated: true,
        origin: "ai",
        media: null,
        createdAt: "2026-09-11T10:00:00.000Z",
      },
    });
  });

  it.each(['{"unexpected":true}', '{"broken"']) (
    "rechaza body no vacío o JSON inválido",
    async (body) => {
      const response = await POST(request(body), params);

      expect(response.status).toBe(400);
      expect(mocks.generate).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["conversation_not_found", 404],
    ["conversation_not_test", 409],
    ["ai_disabled", 409],
    ["handoff_active", 409],
    ["conversation_not_empty", 409],
    ["profile_not_found", 409],
    ["generation_failed", 502],
  ] as const)("mapea %s a una respuesta saneada %i", async (code, status) => {
    mocks.generate.mockRejectedValue(new SimulatedOutreachError(code));

    const response = await POST(request(), params);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(status);
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("SELECT");
  });

  it("sanea errores inesperados sin filtrar detalles", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.generate.mockRejectedValue(
      new Error("password=secret SELECT * FROM message lead@example.com")
    );

    const response = await POST(request(), params);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: { code: "internal", message: "No se pudo generar el outreach" },
      })
    );
    expect(serialized).not.toMatch(/secret|SELECT|lead@example/u);
    expect(consoleError).toHaveBeenCalledWith(
      "[api/simulator/conversations/outreach] no se pudo generar el outreach"
    );
  });
});
