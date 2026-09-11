import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-031/FR-082: el turno del agente sobre una conversación is_test persiste
 * la respuesta en BD, la publica por SSE y JAMÁS invoca el sender real.
 */

const graphRequest = vi.fn();
const publish = vi.fn();
const sendText = vi.fn();

class SendError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/server/events/bus", () => ({ publish }));

vi.mock("@/server/inbox/send", () => ({ SendError, sendText }));

vi.mock("@/lib/ai", () => ({
  chatJson: vi.fn().mockResolvedValue({
    ok: true,
    data: { action: "reply", text: "respuesta simulada" },
    raw: "{}",
  }),
}));

// BD simulada: cola de resultados de select + capturas de insert/update.
const selectQueue: unknown[][] = [];
const inserts: { table: unknown; values: unknown }[] = [];
const persistedAt = new Date("2026-09-11T12:00:00.000Z");

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => void
  ) => Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        const returned = {
          ...(values as Record<string, unknown>),
          error: null,
          waTimestamp: null,
          createdAt: persistedAt,
        };
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([returned]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([returned]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("sandbox del Laboratorio en el pipeline del agente", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    publish.mockReset();
    sendText.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  });

  it("persiste y publica una vez la respuesta is_test sin usar el sender real", async () => {
    const testConversation = {
      id: "cv_lab",
      organizationId: "org_1",
      contactId: "ct_lab",
      isTest: true,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: new Date(),
    };
    selectQueue.push(
      [testConversation], // conversación
      [{ id: "agp_1", organizationId: "org_1", enabled: false, name: "Asistente", tone: null, instructions: null, escalationRules: null, greeting: null }], // perfil (apagado: el Lab evalúa igual)
      [
        {
          id: "msg_1",
          direction: "in",
          text: "¿tienen taladros?",
          createdAt: new Date(),
        },
      ], // historial
      [], // kb
      [] // etapas
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_lab");

    expect(sendText).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
    // la respuesta quedó persistida como mensaje saliente ai_generated
    const messageInsert = inserts.find(
      (i) =>
        typeof i.values === "object" &&
        i.values !== null &&
        (i.values as { direction?: string }).direction === "out"
    );
    expect(messageInsert).toBeDefined();
    expect((messageInsert!.values as { aiGenerated: boolean }).aiGenerated).toBe(
      true
    );
    expect((messageInsert!.values as { text: string }).text).toBe(
      "respuesta simulada"
    );
    expect(messageInsert!.values).toMatchObject({
      conversationId: "cv_lab",
      direction: "out",
      type: "text",
      text: "respuesta simulada",
      status: "sent",
      aiGenerated: true,
      origin: "ai",
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("org_1", {
      type: "message.new",
      data: {
        conversationId: "cv_lab",
        message: {
          id: expect.any(String),
          conversationId: "cv_lab",
          direction: "out",
          type: "text",
          text: "respuesta simulada",
          status: "sent",
          error: null,
          aiGenerated: true,
          origin: "ai",
          media: null,
          createdAt: persistedAt.toISOString(),
        },
      },
    });
  });

  it("mantiene el flujo real en sendText sin persistencia SSE del sandbox", async () => {
    const realConversation = {
      id: "cv_real",
      organizationId: "org_1",
      contactId: "ct_real",
      isTest: false,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: new Date(),
    };
    selectQueue.push(
      [realConversation],
      [
        {
          id: "agp_1",
          organizationId: "org_1",
          enabled: true,
          name: "Asistente",
          tone: null,
          instructions: null,
          escalationRules: null,
          greeting: null,
        },
      ],
      [
        {
          id: "msg_real_in",
          direction: "in",
          text: "Hola",
          createdAt: new Date(),
        },
      ],
      [],
      []
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_real");

    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledWith({
      conversationId: "cv_real",
      organizationId: "org_1",
      text: "respuesta simulada",
      aiGenerated: true,
    });
    expect(inserts).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});
