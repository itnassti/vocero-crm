import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  insertSimulatedOperatorMessage: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: mocks.requireSession };
});

vi.mock("@/server/simulator/operator-messages", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/simulator/operator-messages")>();
  return {
    ...actual,
    insertSimulatedOperatorMessage: mocks.insertSimulatedOperatorMessage,
  };
});

import { UnauthorizedError } from "@/lib/auth/session";
import { POST } from "@/app/api/simulator/conversations/[id]/operator-messages/route";
import { SimulatedOperatorMessageError } from "@/server/simulator/operator-messages";

const params = { params: Promise.resolve({ id: "cv_simulated" }) };

function request(body: unknown): Request {
  return new Request(
    "http://localhost/api/simulator/conversations/cv_simulated/operator-messages",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/simulator/conversations/[id]/operator-messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-active",
      role: "owner",
    });
  });

  it("devuelve 401 cuando no hay sesión", async () => {
    mocks.requireSession.mockRejectedValue(new UnauthorizedError());

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(401);
    expect(mocks.insertSimulatedOperatorMessage).not.toHaveBeenCalled();
  });

  it("devuelve 401 cuando no hay organización activa", async () => {
    mocks.requireSession.mockRejectedValue(
      new UnauthorizedError("Sesión sin organización activa")
    );

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(401);
    expect(mocks.insertSimulatedOperatorMessage).not.toHaveBeenCalled();
  });

  it.each([
    [{ text: 42 }],
    [{ text: "   " }],
    [{ text: "Hola", unexpected: true }],
    [{ text: "a".repeat(4097) }],
  ])("devuelve 400 ante un body inválido o texto fuera de contrato", async (body) => {
    const response = await POST(request(body), params);

    expect(response.status).toBe(400);
    expect(mocks.insertSimulatedOperatorMessage).not.toHaveBeenCalled();
  });

  it("acepta 4096 caracteres y llama una vez con tenant, id y texto normalizado", async () => {
    const text = "a".repeat(4096);
    mocks.insertSimulatedOperatorMessage.mockResolvedValue({ id: "msg-created" });

    const response = await POST(request({ text: `  ${text}  ` }), params);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ messageId: "msg-created" });
    expect(mocks.insertSimulatedOperatorMessage).toHaveBeenCalledOnce();
    expect(mocks.insertSimulatedOperatorMessage).toHaveBeenCalledWith(
      "org-active",
      "cv_simulated",
      text
    );
  });

  it("devuelve 404 saneado para una conversación no accesible", async () => {
    mocks.insertSimulatedOperatorMessage.mockRejectedValue(
      new SimulatedOperatorMessageError("conversation_not_found")
    );

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Conversación simulada no encontrada" },
    });
  });

  it("devuelve 409 saneado para una conversación real", async () => {
    mocks.insertSimulatedOperatorMessage.mockRejectedValue(
      new SimulatedOperatorMessageError("conversation_not_test")
    );

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conversation_not_test",
        message: "La conversación no admite respuestas simuladas",
      },
    });
  });

  it("sanea errores inesperados sin registrar detalles internos", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.insertSimulatedOperatorMessage.mockRejectedValue(
      new Error("password=secret; SELECT * FROM message; lead@example.com")
    );

    const response = await POST(request({ text: "Información privada" }), params);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: {
          code: "internal",
          message: "No se pudo insertar la respuesta simulada",
        },
      })
    );
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("lead@example.com");
    expect(serialized).not.toContain("Información privada");
    expect(consoleError).toHaveBeenCalledWith(
      "[api/simulator/conversations/operator-messages] no se pudo insertar la respuesta"
    );
  });
});
