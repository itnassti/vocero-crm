import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryExpr = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  whereCalls: [] as QueryExpr[],
  chatJson: vi.fn(),
  persist: vi.fn(),
  loadContext: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
}));
vi.mock("@/lib/db/tenant", () => ({
  scoped: (organizationColumn: unknown, organizationId: string, ...conditions: unknown[]) => ({
    op: "scoped",
    organizationColumn,
    organizationId,
    conditions,
  }),
}));
vi.mock("@/lib/db", () => ({
  schema: {
    conversation: {
      organizationId: "conversation.organizationId",
      id: "conversation.id",
    },
    message: {
      organizationId: "message.organizationId",
      conversationId: "message.conversationId",
      id: "message.id",
    },
    agentProfile: { organizationId: "agentProfile.organizationId" },
  },
  getDb: () => ({
    select: () => {
      const rows = mocks.selectQueue.shift() ?? [];
      const chain = {
        from: () => chain,
        where: (where: QueryExpr) => {
          mocks.whereCalls.push(where);
          return chain;
        },
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/ai", () => ({ chatJson: mocks.chatJson }));
vi.mock("@/server/ai/context", () => ({
  loadAgentPromptContext: mocks.loadContext,
}));
vi.mock("@/server/simulator/ai-outbound", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/simulator/ai-outbound")>();
  return { ...actual, persistSimulatedAiOutbound: mocks.persist };
});

import {
  generateSimulatedFirstOutreach,
  simulatedFirstOutreachActionSchema,
} from "@/server/simulator/outreach";

const conversation = {
  id: "cv_test",
  organizationId: "org_active",
  contactId: "ct_test",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
};

const profile = {
  id: "agp_1",
  organizationId: "org_active",
  enabled: false,
  name: "Nuria",
  tone: "cercano y breve",
  instructions: "Haz discovery sin repetir preguntas",
  escalationRules: "Escala solo cuando lo pidan",
  greeting: "Hola",
};

const createdMessage = {
  id: "msg_outreach",
  organizationId: "org_active",
  conversationId: "cv_test",
  direction: "out",
  type: "text",
  text: "Hola Lucía, vi que quieres ganar constancia.",
  status: "sent",
  error: null,
  waMessageId: null,
  waTimestamp: null,
  aiGenerated: true,
  origin: "ai",
  createdAt: new Date("2026-09-11T10:00:00.000Z"),
};

function validDbReads(overrides: Partial<typeof conversation> = {}) {
  mocks.selectQueue.push([{ ...conversation, ...overrides }], [], [profile]);
}

describe("generateSimulatedFirstOutreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQueue.length = 0;
    mocks.whereCalls.length = 0;
    mocks.loadContext.mockResolvedValue({
      kb: [{ kind: "qa", question: "¿Qué ofrecemos?", answer: "Coaching online" }],
      stages: [{ id: "stage_new", name: "Nuevo" }],
      leadContext: {
        name: "Lucía Test",
        source: "anuncio",
        stageName: "Nuevo",
        ficha: {
          country: "España",
          goal: "Ganar constancia",
          obstacles: "Fines de semana",
          willingToInvest: true,
        },
      },
    });
    mocks.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: createdMessage.text },
      raw: "{}",
    });
    mocks.persist.mockResolvedValue(createdMessage);
  });

  it("rechaza conversación inexistente u oculta por tenant antes del LLM", async () => {
    mocks.selectQueue.push([]);

    await expect(
      generateSimulatedFirstOutreach("org_active", "cv_other")
    ).rejects.toMatchObject({ code: "conversation_not_found" });

    expect(mocks.whereCalls[0]).toMatchObject({
      op: "scoped",
      organizationId: "org_active",
      conditions: [{ op: "eq", column: "conversation.id", value: "cv_other" }],
    });
    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    [{ isTest: false }, "conversation_not_test"],
    [{ aiEnabled: false }, "ai_disabled"],
    [{ handoffAt: new Date() }, "handoff_active"],
  ] as const)("rechaza estado incompatible antes del LLM: %s", async (overrides, code) => {
    mocks.selectQueue.push([{ ...conversation, ...overrides }]);

    await expect(
      generateSimulatedFirstOutreach("org_active", "cv_test")
    ).rejects.toMatchObject({ code });

    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rechaza cualquier historial dentro del lock sin generar ni persistir", async () => {
    mocks.selectQueue.push([conversation], [{ id: "msg_existing" }]);

    await expect(
      generateSimulatedFirstOutreach("org_active", "cv_test")
    ).rejects.toMatchObject({ code: "conversation_not_empty" });

    expect(mocks.whereCalls[1]).toMatchObject({
      op: "scoped",
      organizationId: "org_active",
      conditions: [{ op: "eq", column: "message.conversationId", value: "cv_test" }],
    });
    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("permite profile desactivado e inyecta profile, KB, ficha, stage y modo", async () => {
    validDbReads();

    const result = await generateSimulatedFirstOutreach("org_active", "cv_test");

    expect(result).toBe(createdMessage);
    expect(mocks.loadContext).toHaveBeenCalledWith("org_active", "ct_test");
    expect(mocks.chatJson).toHaveBeenCalledOnce();
    expect(mocks.chatJson.mock.calls[0]?.[0]).toBe(
      simulatedFirstOutreachActionSchema
    );
    const messages = mocks.chatJson.mock.calls[0]?.[1] as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain('Eres "Nuria"');
    expect(messages[0]?.content).toContain("Tono: cercano y breve");
    expect(messages[0]?.content).toContain("Haz discovery sin repetir preguntas");
    expect(messages[0]?.content).toContain("P: ¿Qué ofrecemos?\nR: Coaching online");
    expect(messages[0]?.content).toContain("- Nombre: Lucía Test");
    expect(messages[0]?.content).toContain("- Objetivo: Ganar constancia");
    expect(messages[0]?.content).toContain("- Etapa actual: Nuevo");
    expect(messages[0]?.content).toContain("MODO DEL TURNO: PRIMER OUTREACH");
    expect(messages[0]?.content).toContain("interés en Jynfits");
    expect(messages[0]?.content).not.toContain('"action":"handoff"');
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(mocks.persist).toHaveBeenCalledWith(
      "org_active",
      "cv_test",
      createdMessage.text,
      { requireEmptyHistory: true }
    );
  });

  it.each([
    { action: "none" },
    { action: "handoff", reason: "x" },
    { action: "move_stage", stage: "Interesado" },
    { action: "update_lead", note: "x" },
    { action: "offer_slots", reply: "x" },
    { action: "book_slot", startUtc: "2026-09-12T10:00:00Z", reply: "x" },
    { action: "reply", text: "Hola", extra: true },
  ])("el contrato reply-only rechaza otras acciones o efectos", (action) => {
    expect(simulatedFirstOutreachActionSchema.safeParse(action).success).toBe(false);
  });

  it("un fallo del proveedor no persiste ni provoca efectos", async () => {
    validDbReads();
    mocks.chatJson.mockResolvedValue({
      ok: false,
      error: "invalid_json",
      detail: "salida inválida",
    });

    await expect(
      generateSimulatedFirstOutreach("org_active", "cv_test")
    ).rejects.toMatchObject({ code: "generation_failed" });

    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("coalese dos requests concurrentes en una generación y persistencia", async () => {
    validDbReads();
    let resolveGeneration!: (value: unknown) => void;
    mocks.chatJson.mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      })
    );

    const first = generateSimulatedFirstOutreach("org_active", "cv_test");
    const second = generateSimulatedFirstOutreach("org_active", "cv_test");
    await vi.waitFor(() => expect(mocks.chatJson).toHaveBeenCalledOnce());
    resolveGeneration({
      ok: true,
      data: { action: "reply", text: createdMessage.text },
      raw: "{}",
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      createdMessage,
      createdMessage,
    ]);
    expect(mocks.chatJson).toHaveBeenCalledOnce();
    expect(mocks.persist).toHaveBeenCalledOnce();

    mocks.selectQueue.push([conversation], [{ id: "msg_outreach" }]);
    await expect(
      generateSimulatedFirstOutreach("org_active", "cv_test")
    ).rejects.toMatchObject({ code: "conversation_not_empty" });
    expect(mocks.chatJson).toHaveBeenCalledOnce();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it("no crea inbound sintético ni importa fronteras externas", () => {
    const source = readFileSync(
      new URL("../../src/server/simulator/outreach.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/direction\s*:\s*["']in["']/u);
    expect(source).not.toMatch(
      /sendText|graphRequest|from ["'][^"']*(?:meta|whatsapp|agenda)[^"']*["']/iu
    );
  });
});
