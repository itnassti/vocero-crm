import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Conversation = {
  id: string;
  organizationId: string;
  contactId: string;
  isTest: boolean;
  aiEnabled: boolean;
  handoffAt: Date | null;
};

type QueryExpr =
  | { op: "eq"; column: unknown; value: unknown }
  | {
      op: "scoped";
      organizationColumn: unknown;
      organizationId: string;
      conditions: QueryExpr[];
    };

const mocks = vi.hoisted(() => ({
  conversations: [] as Conversation[],
  selects: [] as { where?: QueryExpr }[],
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  updates: [] as {
    table: unknown;
    values: Record<string, unknown>;
    where: QueryExpr;
  }[],
  onLeadActivity: vi.fn(),
  publish: vi.fn(),
  maybeRunAgentTurn: vi.fn(),
  schema: {
    conversation: {
      id: "conversation.id",
      organizationId: "conversation.organizationId",
      isTest: "conversation.isTest",
      unreadCount: "conversation.unreadCount",
    },
    message: {
      id: "message.id",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown): QueryExpr => ({
    op: "eq",
    column,
    value,
  }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    strings,
    values,
  }),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (
    organizationColumn: unknown,
    organizationId: string,
    ...conditions: QueryExpr[]
  ): QueryExpr => ({
    op: "scoped",
    organizationColumn,
    organizationId,
    conditions,
  }),
}));

vi.mock("@/lib/db/ids", () => ({
  newId: () => "msg_simulated",
}));

function matchesConversation(row: Conversation, where?: QueryExpr): boolean {
  if (!where || where.op !== "scoped") return false;
  if (row.organizationId !== where.organizationId) return false;
  return where.conditions.every((condition) => {
    if (condition.op !== "eq") return false;
    if (condition.column === mocks.schema.conversation.id) {
      return row.id === condition.value;
    }
    if (condition.column === mocks.schema.conversation.isTest) {
      return row.isTest === condition.value;
    }
    return false;
  });
}

vi.mock("@/lib/db", () => ({
  schema: mocks.schema,
  getDb: () => {
    const db = {
    transaction: (work: (tx: unknown) => unknown) => work(db),
    select: () => {
      const call: { where?: QueryExpr } = {};
      mocks.selects.push(call);
      const chain = {
        from: () => chain,
        where: (where: QueryExpr) => {
          call.where = where;
          return chain;
        },
        for: () => chain,
        limit: () =>
          Promise.resolve(
            mocks.conversations.filter((row) =>
              matchesConversation(row, call.where)
            )
          ),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push({ table, values });
        return {
          returning: () =>
            Promise.resolve([
              {
                ...values,
                error: null,
                aiGenerated: false,
                origin: "operator",
                createdAt: values.waTimestamp,
              },
            ]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: QueryExpr) => {
          mocks.updates.push({ table, values, where });
          return Promise.resolve();
        },
      }),
    }),
    };
    return db;
  },
}));

vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));

vi.mock("@/server/inbox/lead-activity", () => ({
  onLeadActivity: mocks.onLeadActivity,
}));

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: mocks.maybeRunAgentTurn,
}));

import {
  insertSimulatedInboundMessage,
  SimulatedInboundMessageError,
} from "@/server/simulator/messages";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "cv_test",
    organizationId: "org_active",
    contactId: "ct_test",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    ...overrides,
  };
}

describe("insertSimulatedInboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations.length = 0;
    mocks.selects.length = 0;
    mocks.inserts.length = 0;
    mocks.updates.length = 0;
  });

  it("rechaza una conversación inexistente", async () => {
    await expect(
      insertSimulatedInboundMessage("org_active", "cv_missing", "Hola")
    ).rejects.toMatchObject({ code: "conversation_not_found" });

    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.maybeRunAgentTurn).not.toHaveBeenCalled();
  });

  it("rechaza una conversación de otra organización mediante el scope", async () => {
    mocks.conversations.push(conversation({ organizationId: "org_other" }));

    await expect(
      insertSimulatedInboundMessage("org_active", "cv_test", "Hola")
    ).rejects.toBeInstanceOf(SimulatedInboundMessageError);

    expect(mocks.selects[0]?.where).toMatchObject({
      op: "scoped",
      organizationId: "org_active",
      conditions: [
        { op: "eq", column: "conversation.id", value: "cv_test" },
      ],
    });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("rechaza una conversación real", async () => {
    mocks.conversations.push(conversation({ isTest: false }));

    await expect(
      insertSimulatedInboundMessage("org_active", "cv_test", "Hola")
    ).rejects.toMatchObject({ code: "conversation_not_test" });

    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("persiste la entrada, actualiza actividad y publica los eventos SSE", async () => {
    mocks.conversations.push(conversation());

    const message = await insertSimulatedInboundMessage(
      "org_active",
      "cv_test",
      "Quiero información"
    );

    expect(message.id).toBe("msg_simulated");
    expect(mocks.inserts).toEqual([
      {
        table: mocks.schema.message,
        values: expect.objectContaining({
          id: "msg_simulated",
          organizationId: "org_active",
          conversationId: "cv_test",
          waMessageId: null,
          direction: "in",
          type: "text",
          text: "Quiero información",
          status: "delivered",
        }),
      },
    ]);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      table: mocks.schema.conversation,
      values: {
        lastInboundAt: expect.any(Date),
        lastMessageAt: expect.any(Date),
        unreadCount: {
          op: "sql",
          strings: ["", " + 1"],
          values: ["conversation.unreadCount"],
        },
        updatedAt: expect.any(Date),
      },
      where: {
        op: "scoped",
        organizationId: "org_active",
        conditions: expect.arrayContaining([
          { op: "eq", column: "conversation.id", value: "cv_test" },
          { op: "eq", column: "conversation.isTest", value: true },
        ]),
      },
    });
    const activityAt = mocks.inserts[0]?.values.waTimestamp;
    expect(activityAt).toBeInstanceOf(Date);
    expect(mocks.onLeadActivity).toHaveBeenCalledOnce();
    expect(mocks.onLeadActivity).toHaveBeenCalledWith(
      "org_active",
      "ct_test",
      activityAt
    );
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenNthCalledWith(
      1,
      "org_active",
      {
        type: "message.new",
        data: {
          conversationId: "cv_test",
          message: {
            id: "msg_simulated",
            conversationId: "cv_test",
            direction: "in",
            type: "text",
            text: "Quiero información",
            status: "delivered",
            error: null,
            aiGenerated: false,
            origin: "operator",
            media: null,
            createdAt: (activityAt as Date).toISOString(),
          },
        },
      }
    );
    expect(mocks.publish).toHaveBeenNthCalledWith(2, "org_active", {
      type: "conversation.updated",
      data: { conversation: { id: "cv_test" } },
    });
  });

  it("ejecuta una vez el agente con IA activa y sin handoff", async () => {
    mocks.conversations.push(conversation());

    await insertSimulatedInboundMessage("org_active", "cv_test", "Hola");

    expect(mocks.maybeRunAgentTurn).toHaveBeenCalledOnce();
    expect(mocks.maybeRunAgentTurn).toHaveBeenCalledWith("cv_test");
  });

  it("no ejecuta el agente con IA desactivada", async () => {
    mocks.conversations.push(conversation({ aiEnabled: false }));

    await insertSimulatedInboundMessage("org_active", "cv_test", "Hola");

    expect(mocks.maybeRunAgentTurn).not.toHaveBeenCalled();
  });

  it("no ejecuta el agente durante un handoff", async () => {
    mocks.conversations.push(conversation({ handoffAt: new Date() }));

    await insertSimulatedInboundMessage("org_active", "cv_test", "Hola");

    expect(mocks.maybeRunAgentTurn).not.toHaveBeenCalled();
  });

  it("no importa fronteras de envío, Meta, WhatsApp ni agenda", () => {
    const source = readFileSync(
      new URL("../../src/server/simulator/messages.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/server\/inbox\/send|lib\/meta|server\/whatsapp/);
    expect(source).not.toMatch(/server\/agenda|sendText|graphRequest/);
  });
});
