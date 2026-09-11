import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Expr =
  | { op: "eq"; column: string; value: unknown }
  | { op: "scoped"; organizationId: string; conditions: Expr[] }
  | { op: "sql" };

const mocks = vi.hoisted(() => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries([
      ["__name", name],
      ...columns.map((column) => [column, `${name}.${column}`]),
    ]);
  return {
    schema: {
      conversation: table("conversation", [
        "id",
        "organizationId",
        "isTest",
        "unreadCount",
      ]),
      message: table("message", [
        "id",
        "organizationId",
        "conversationId",
        "createdAt",
      ]),
      agentProfile: table("agentProfile", ["organizationId"]),
      kbEntry: table("kbEntry", ["organizationId", "createdAt"]),
      pipelineStage: table("pipelineStage", [
        "id",
        "organizationId",
        "name",
        "position",
      ]),
    },
    conversations: [] as Row[],
    messages: [] as Row[],
    profiles: [] as Row[],
    kb: [] as Row[],
    stages: [] as Row[],
    contact: null as Row | null,
    currentStage: null as Row | null,
    chatJson: vi.fn(),
    publish: vi.fn(),
    sendText: vi.fn(),
    maybeRunAgentTurn: vi.fn(),
    onLeadActivity: vi.fn(),
    lockedTables: [] as string[],
    nextId: 1,
    transactionTail: Promise.resolve() as Promise<unknown>,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown): Expr => ({ op: "eq", column, value }),
  asc: () => ({ op: "asc" }),
  desc: () => ({ op: "desc" }),
  sql: (): Expr => ({ op: "sql" }),
}));
vi.mock("@/lib/db/tenant", () => ({
  scoped: (_column: unknown, organizationId: string, ...conditions: Expr[]): Expr => ({
    op: "scoped",
    organizationId,
    conditions,
  }),
}));
vi.mock("@/lib/db/ids", () => ({
  newId: () => `msg_flow_${mocks.nextId++}`,
}));

function rowsFor(table: Row, where?: Expr): Row[] {
  const name = table.__name;
  const rows =
    name === "conversation"
      ? mocks.conversations
      : name === "message"
        ? mocks.messages
        : name === "agentProfile"
          ? mocks.profiles
          : name === "kbEntry"
            ? mocks.kb
            : mocks.stages;
  if (!where || where.op !== "scoped") return [...rows];
  return rows.filter((row) => {
    if (row.organizationId !== where.organizationId) return false;
    return where.conditions.every((condition) => {
      if (condition.op !== "eq") return true;
      const key = condition.column.split(".").at(-1);
      return key ? row[key] === condition.value : false;
    });
  });
}

vi.mock("@/lib/db", () => ({
  schema: mocks.schema,
  getDb: () => {
    const db: Record<string, unknown> = {
      transaction: <T>(
        work: (tx: Record<string, unknown>) => Promise<T>
      ): Promise<T> => {
        const result = mocks.transactionTail.then(() => work(db));
        mocks.transactionTail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      },
      select: () => {
        let source: Row;
        let where: Expr | undefined;
        const resolve = () => {
          const rows = rowsFor(source, where);
          return source === mocks.schema.message
            ? rows.sort(
                (a, b) =>
                  (b.createdAt as Date).getTime() -
                  (a.createdAt as Date).getTime()
              )
            : rows;
        };
        const chain = {
          from: (table: Row) => {
            source = table;
            return chain;
          },
          where: (expr: Expr) => {
            where = expr;
            return chain;
          },
          orderBy: () => chain,
          for: () => {
            mocks.lockedTables.push(String(source.__name));
            return chain;
          },
          limit: (count: number) => Promise.resolve(resolve().slice(0, count)),
          then: (resolvePromise: (value: Row[]) => unknown) =>
            Promise.resolve(resolve()).then(resolvePromise),
        };
        return chain;
      },
      insert: (table: Row) => ({
        values: (values: Row) => ({
          returning: () => {
            const createdAt = new Date(
              `2026-09-11T10:00:0${mocks.messages.length}.000Z`
            );
            const row = {
              ...values,
              error: null,
              aiGenerated: values.aiGenerated ?? false,
              origin: values.origin ?? "operator",
              waTimestamp: values.waTimestamp ?? null,
              createdAt,
            };
            if (table === mocks.schema.message) mocks.messages.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
      update: (table: Row) => ({
        set: (values: Row) => ({
          where: (expr: Expr) => {
            for (const row of rowsFor(table, expr)) {
              for (const [key, value] of Object.entries(values)) {
                row[key] =
                  key === "unreadCount" &&
                  typeof value === "object" &&
                  value !== null
                    ? Number(row[key] ?? 0) + 1
                    : value;
              }
            }
            return Promise.resolve();
          },
        }),
      }),
    };
    return db;
  },
}));

vi.mock("@/lib/ai", () => ({ chatJson: mocks.chatJson }));
vi.mock("@/lib/env", () => ({
  isAiConfigured: () => true,
  getEnv: () => ({ AGENT_COALESCE_MS: 0 }),
}));
vi.mock("@/server/contacts", () => ({
  getContactById: () => Promise.resolve(mocks.contact),
  getContactStage: () => Promise.resolve(mocks.currentStage),
}));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error {},
  sendText: mocks.sendText,
}));
vi.mock("@/server/inbox/lead-activity", () => ({
  onLeadActivity: mocks.onLeadActivity,
}));
vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: mocks.maybeRunAgentTurn,
}));
vi.mock("@/server/ai/handoff", () => ({ matchesHandoffIntent: () => false }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: () => false }));
vi.mock("@/server/agenda/offers", () => ({
  getOffers: () => Promise.resolve([]),
  mapaDeHuecosParaModelo: () => "",
}));

import { runAgentTurn } from "@/server/ai/pipeline";
import { insertSimulatedInboundMessage } from "@/server/simulator/messages";
import { generateSimulatedFirstOutreach } from "@/server/simulator/outreach";

function seedConversation() {
  mocks.conversations.push({
    id: "cv_flow",
    organizationId: "org_1",
    contactId: "ct_flow",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    unreadCount: 0,
    lastInboundAt: null,
  });
  mocks.profiles.push({
    id: "agp_1",
    organizationId: "org_1",
    enabled: false,
    name: "Nuria",
    tone: "cercano",
    instructions: "Haz discovery",
    escalationRules: "Escala cuando lo soliciten",
    greeting: "Hola",
  });
  mocks.kb.push({
    organizationId: "org_1",
    kind: "qa",
    question: "¿Qué ofrecemos?",
    answer: "Acompañamiento online",
    createdAt: new Date(),
  });
  mocks.stages.push({
    id: "stage_new",
    organizationId: "org_1",
    name: "Nuevo",
    position: 0,
  });
  mocks.contact = {
    id: "ct_flow",
    organizationId: "org_1",
    name: "Lucía Test",
    source: "anuncio",
    ficha: { goal: "Ganar constancia", country: "España" },
  };
  mocks.currentStage = {
    lead: { id: "lead_flow" },
    stage: { id: "stage_new", name: "Nuevo" },
  };
}

describe("flujo integrado del primer outreach simulado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations.length = 0;
    mocks.messages.length = 0;
    mocks.profiles.length = 0;
    mocks.kb.length = 0;
    mocks.stages.length = 0;
    mocks.nextId = 1;
    mocks.lockedTables.length = 0;
    mocks.transactionTail = Promise.resolve();
    seedConversation();
  });

  it("aborta el outreach si llega un inbound mientras el LLM está pendiente", async () => {
    let release!: (value: unknown) => void;
    mocks.chatJson.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const outreach = generateSimulatedFirstOutreach("org_1", "cv_flow");
    await vi.waitFor(() => expect(mocks.chatJson).toHaveBeenCalledOnce());

    const inbound = await insertSimulatedInboundMessage(
      "org_1",
      "cv_flow",
      "Quiero saber más"
    );
    release({
      ok: true,
      data: { action: "reply", text: "Hola Lucía" },
      raw: "{}",
    });

    await expect(outreach).rejects.toMatchObject({
      code: "conversation_not_empty",
    });
    expect(inbound.direction).toBe("in");
    expect(mocks.messages).toHaveLength(1);
    expect(mocks.messages[0]).toMatchObject({
      id: inbound.id,
      direction: "in",
      text: "Quiero saber más",
    });
    expect(mocks.lockedTables).toEqual(["conversation", "conversation"]);
    expect(
      mocks.publish.mock.calls.filter(
        ([, event]) =>
          event.type === "message.new" && event.data.message.direction === "out"
      )
    ).toHaveLength(0);
  });

  it("conserva outreach e inbound reales en orden para el siguiente turno normal", async () => {
    mocks.chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Hola Lucía, vi tu formulario." },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Gracias por contármelo." },
        raw: "{}",
      });

    const outreach = await generateSimulatedFirstOutreach("org_1", "cv_flow");
    await insertSimulatedInboundMessage(
      "org_1",
      "cv_flow",
      "Me cuesta mantener la constancia"
    );
    await runAgentTurn("cv_flow");

    expect(outreach).toMatchObject({
      direction: "out",
      aiGenerated: true,
      text: "Hola Lucía, vi tu formulario.",
    });
    expect(mocks.maybeRunAgentTurn).toHaveBeenCalledWith("cv_flow");
    expect(mocks.chatJson).toHaveBeenCalledTimes(2);
    const secondTurn = mocks.chatJson.mock.calls[1]?.[1] as {
      role: string;
      content: string;
    }[];
    expect(secondTurn.slice(1)).toEqual([
      { role: "assistant", content: "Hola Lucía, vi tu formulario." },
      { role: "user", content: "Me cuesta mantener la constancia" },
    ]);
    expect(secondTurn[0]?.content).not.toContain(
      "MODO DEL TURNO: PRIMER OUTREACH"
    );
    expect(secondTurn[0]?.content).toContain('Eres "Nuria"');
    expect(secondTurn[0]?.content).toContain("P: ¿Qué ofrecemos?");
    expect(secondTurn[0]?.content).toContain("- Objetivo: Ganar constancia");
    expect(secondTurn[0]?.content).toContain(
      "Etapas del pipeline disponibles: Nuevo"
    );
    expect(mocks.messages.filter((message) => message.direction === "in")).toHaveLength(1);
    expect(mocks.sendText).not.toHaveBeenCalled();
  });
});
