import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createSimulatedLead: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: mocks.requireSession };
});

vi.mock("@/server/simulator/leads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/simulator/leads")>();
  return { ...actual, createSimulatedLead: mocks.createSimulatedLead };
});

import { UnauthorizedError } from "@/lib/auth/session";
import { SimulatedLeadCreationError } from "@/server/simulator/leads";
import { POST } from "@/app/api/simulator/leads/route";

const validInput = {
  name: "Ada Lovelace",
  phone: null,
  email: "ada@example.com",
  ageRange: "35-44",
  country: "España",
  goal: "Mejorar su salud",
  obstacles: "Falta de tiempo",
  willingToInvest: true,
  source: "anuncio" as const,
  platform: "instagram",
  campaignId: "campaign-1",
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/simulator/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/simulator/leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-active",
      role: "owner",
    });
  });

  it("devuelve 401 si no hay sesión", async () => {
    mocks.requireSession.mockRejectedValue(new UnauthorizedError());

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "No autenticado" },
    });
    expect(mocks.createSimulatedLead).not.toHaveBeenCalled();
  });

  it("devuelve 401 si la sesión no tiene organización activa", async () => {
    mocks.requireSession.mockRejectedValue(
      new UnauthorizedError("Sesión sin organización activa")
    );

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    expect(mocks.createSimulatedLead).not.toHaveBeenCalled();
  });

  it("devuelve 400 sin llamar al servicio ante un payload inválido", async () => {
    const response = await POST(request({ ...validInput, willingToInvest: "sí" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_body",
        message: "El payload del lead simulado no es válido",
      },
    });
    expect(mocks.createSimulatedLead).not.toHaveBeenCalled();
  });

  it("usa una vez la organización activa y devuelve los IDs creados", async () => {
    mocks.createSimulatedLead.mockResolvedValue({
      contact: { id: "ct-created" },
      lead: { id: "ld-created", stageId: "stage-open" },
      conversation: { id: "cv-created" },
    });

    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(mocks.createSimulatedLead).toHaveBeenCalledOnce();
    expect(mocks.createSimulatedLead).toHaveBeenCalledWith("org-active", validInput);
    expect(await response.json()).toEqual({
      contactId: "ct-created",
      leadId: "ld-created",
      conversationId: "cv-created",
    });
  });

  it("clasifica la ausencia de etapa abierta sin filtrar detalles", async () => {
    mocks.createSimulatedLead.mockRejectedValue(
      new SimulatedLeadCreationError("no_open_stage")
    );

    const response = await POST(request(validInput));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "no_open_stage",
        message: "El pipeline no tiene una etapa abierta para el lead simulado",
      },
    });
  });

  it("sanea errores inesperados del servicio y del log", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createSimulatedLead.mockRejectedValue(
      new Error("password=secret; SELECT * FROM contact; ada@example.com")
    );

    const response = await POST(request(validInput));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: { code: "internal", message: "No se pudo crear el lead simulado" },
      })
    );
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("ada@example.com");
    expect(consoleError).toHaveBeenCalledWith(
      "[api/simulator/leads] no se pudo crear el lead simulado"
    );
  });
});
