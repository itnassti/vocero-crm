import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  insertSimulatedInboundMessage: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: mocks.requireSession };
});

vi.mock("@/server/simulator/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/simulator/messages")>();
  return {
    ...actual,
    insertSimulatedInboundMessage: mocks.insertSimulatedInboundMessage,
  };
});

import { UnauthorizedError } from "@/lib/auth/session";
import { POST } from "@/app/api/simulator/conversations/[id]/messages/route";
import { SimulatedInboundMessageError } from "@/server/simulator/messages";

const params = { params: Promise.resolve({ id: "cv_simulated" }) };

function request(body: unknown): Request {
  return new Request(
    "http://localhost/api/simulator/conversations/cv_simulated/messages",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/simulator/conversations/[id]/messages", () => {
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
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "No autenticado" },
    });
    expect(mocks.insertSimulatedInboundMessage).not.toHaveBeenCalled();
  });

  it("devuelve 400 ante un payload inválido", async () => {
    const response = await POST(request({ text: 42 }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_body", message: "El mensaje simulado no es válido" },
    });
    expect(mocks.insertSimulatedInboundMessage).not.toHaveBeenCalled();
  });

  it("devuelve 400 si el texto queda vacío tras trim", async () => {
    const response = await POST(request({ text: "   " }), params);

    expect(response.status).toBe(400);
    expect(mocks.insertSimulatedInboundMessage).not.toHaveBeenCalled();
  });

  it("devuelve 400 si el body contiene campos extra", async () => {
    const response = await POST(
      request({ text: "Hola", unexpected: "value" }),
      params
    );

    expect(response.status).toBe(400);
    expect(mocks.insertSimulatedInboundMessage).not.toHaveBeenCalled();
  });

  it("acepta exactamente 4096 caracteres y rechaza 4097", async () => {
    const acceptedText = "a".repeat(4096);
    mocks.insertSimulatedInboundMessage.mockResolvedValue({ id: "msg-limit" });

    const acceptedResponse = await POST(request({ text: acceptedText }), params);
    const rejectedResponse = await POST(
      request({ text: "a".repeat(4097) }),
      params
    );

    expect(acceptedResponse.status).toBe(201);
    expect(rejectedResponse.status).toBe(400);
    expect(mocks.insertSimulatedInboundMessage).toHaveBeenCalledOnce();
    expect(mocks.insertSimulatedInboundMessage).toHaveBeenCalledWith(
      "org-active",
      "cv_simulated",
      acceptedText
    );
  });

  it("devuelve 401 si la sesión no tiene organización activa", async () => {
    mocks.requireSession.mockRejectedValue(
      new UnauthorizedError("Sesión sin organización activa")
    );

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "No autenticado" },
    });
    expect(mocks.insertSimulatedInboundMessage).not.toHaveBeenCalled();
  });

  it("usa una vez la organización, conversación y texto normalizado correctos", async () => {
    mocks.insertSimulatedInboundMessage.mockResolvedValue({ id: "msg-created" });

    const response = await POST(
      request({ text: "  Me cuesta ser constante los fines de semana  " }),
      params
    );

    expect(mocks.insertSimulatedInboundMessage).toHaveBeenCalledOnce();
    expect(mocks.insertSimulatedInboundMessage).toHaveBeenCalledWith(
      "org-active",
      "cv_simulated",
      "Me cuesta ser constante los fines de semana"
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ messageId: "msg-created" });
  });

  it("oculta conversaciones inexistentes o no accesibles", async () => {
    mocks.insertSimulatedInboundMessage.mockRejectedValue(
      new SimulatedInboundMessageError("conversation_not_found")
    );

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Conversación simulada no encontrada" },
    });
  });

  it("rechaza de forma saneada una conversación real", async () => {
    mocks.insertSimulatedInboundMessage.mockRejectedValue(
      new SimulatedInboundMessageError("conversation_not_test")
    );

    const response = await POST(request({ text: "Hola" }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conversation_not_test",
        message: "La conversación no admite mensajes simulados",
      },
    });
  });

  it("sanea errores inesperados del servicio y del log", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.insertSimulatedInboundMessage.mockRejectedValue(
      new Error("password=secret; SELECT * FROM message; lead@example.com")
    );

    const response = await POST(request({ text: "Información privada" }), params);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: {
          code: "internal",
          message: "No se pudo insertar el mensaje simulado",
        },
      })
    );
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("lead@example.com");
    expect(serialized).not.toContain("Información privada");
    expect(consoleError).toHaveBeenCalledWith(
      "[api/simulator/conversations/messages] no se pudo insertar el mensaje"
    );
  });
});
