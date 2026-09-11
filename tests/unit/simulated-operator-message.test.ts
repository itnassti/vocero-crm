import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Conversation = {
  id: string;
  organizationId: string;
  isTest: boolean;
  aiEnabled: boolean;
  handoffAt: Date | null;
};

type QueryExpr =
  | { op: "eq"; column: unknown; value: unknown }
  | { op: "sql"; strings: string[]; values: unknown[] }
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
  publish: vi.fn(),
  schema: {
    conversation: {
      id: "conversation.id",
      organizationId: "conversation.organizationId",
      isTest: "conversation.isTest",
      handoffAt: "conversation.handoffAt",
    },
    message: { id: "message.id" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown): QueryExpr => ({
    op: "eq",
    column,
    value,
  }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]): QueryExpr => ({
    op: "sql",
    strings: [...strings],
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

function matchesConversation(row: Conversation, where?: QueryExpr): boolean {
  if (!where || where.op !== "scoped") return false;
  if (row.organizationId !== where.organizationId) return false;
  return where.conditions.every((condition) => {
    if (condition.op === "sql") return row.handoffAt === null;
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

vi.mock("@/lib/db/ids", () => ({ newId: () => "msg_operator" }));

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
                waTimestamp: null,
                error: null,
                createdAt: new Date("2026-09-10T12:00:00.000Z"),
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

import {
  insertSimulatedOperatorMessage,
  SimulatedOperatorMessageError,
} from "@/server/simulator/operator-messages";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "cv_test",
    organizationId: "org_active",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    ...overrides,
  };
}

describe("insertSimulatedOperatorMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations.length = 0;
    mocks.selects.length = 0;
    mocks.inserts.length = 0;
    mocks.updates.length = 0;
  });

  it("rechaza una conversación inexistente", async () => {
    await expect(
      insertSimulatedOperatorMessage("org_active", "cv_missing", "Hola")
    ).rejects.toMatchObject({ code: "conversation_not_found" });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("oculta una conversación de otro tenant mediante el scope", async () => {
    mocks.conversations.push(conversation({ organizationId: "org_other" }));

    await expect(
      insertSimulatedOperatorMessage("org_active", "cv_test", "Hola")
    ).rejects.toBeInstanceOf(SimulatedOperatorMessageError);

    expect(mocks.selects[0]?.where).toEqual({
      op: "scoped",
      organizationColumn: "conversation.organizationId",
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
      insertSimulatedOperatorMessage("org_active", "cv_test", "Hola")
    ).rejects.toMatchObject({ code: "conversation_not_test" });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("persiste la salida local, publica SSE y activa el takeover canónico", async () => {
    mocks.conversations.push(conversation());

    const message = await insertSimulatedOperatorMessage(
      "org_active",
      "cv_test",
      "  Perfecto, te explico cómo funciona.  "
    );

    expect(message.id).toBe("msg_operator");
    expect(mocks.inserts).toEqual([
      {
        table: mocks.schema.message,
        values: {
          id: "msg_operator",
          organizationId: "org_active",
          conversationId: "cv_test",
          waMessageId: null,
          direction: "out",
          type: "text",
          text: "Perfecto, te explico cómo funciona.",
          status: "sent",
          aiGenerated: false,
          origin: "operator",
        },
      },
    ]);
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[0]).toMatchObject({
      table: mocks.schema.conversation,
      values: {
        lastMessageAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
      where: {
        op: "scoped",
        organizationId: "org_active",
        conditions: [
          { op: "eq", column: "conversation.id", value: "cv_test" },
          { op: "eq", column: "conversation.isTest", value: true },
        ],
      },
    });
    expect(mocks.updates[0]?.values).not.toHaveProperty("lastInboundAt");
    expect(mocks.updates[0]?.values).not.toHaveProperty("unreadCount");
    expect(mocks.updates[1]).toMatchObject({
      table: mocks.schema.conversation,
      values: {
        aiEnabled: false,
        handoffAt: expect.any(Date),
        handoffReason: "manual_reply",
        updatedAt: expect.any(Date),
      },
      where: {
        op: "scoped",
        organizationId: "org_active",
        conditions: [
          { op: "eq", column: "conversation.id", value: "cv_test" },
          { op: "eq", column: "conversation.isTest", value: true },
          {
            op: "sql",
            strings: ["", " is null"],
            values: ["conversation.handoffAt"],
          },
        ],
      },
    });
    expect(mocks.publish).toHaveBeenNthCalledWith(1, "org_active", {
      type: "message.new",
      data: {
        conversationId: "cv_test",
        message: {
          id: "msg_operator",
          conversationId: "cv_test",
          direction: "out",
          type: "text",
          text: "Perfecto, te explico cómo funciona.",
          status: "sent",
          error: null,
          aiGenerated: false,
          origin: "operator",
          media: null,
          createdAt: "2026-09-10T12:00:00.000Z",
        },
      },
    });
    expect(mocks.publish).toHaveBeenNthCalledWith(2, "org_active", {
      type: "conversation.updated",
      data: { conversation: { id: "cv_test" } },
    });
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });

  it("conserva un handoff existente y solo actualiza la actividad", async () => {
    mocks.conversations.push(conversation({ handoffAt: new Date() }));

    await insertSimulatedOperatorMessage("org_active", "cv_test", "Hola");

    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]?.values).toEqual({
      lastMessageAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("no importa ninguna frontera de envío o proveedor externo", () => {
    const source = readFileSync(
      new URL(
        "../../src/server/simulator/operator-messages.ts",
        import.meta.url
      ),
      "utf8"
    );

    expect(source).not.toMatch(/server\/inbox\/send|sendText|lib\/meta/);
    expect(source).not.toMatch(/server\/whatsapp|server\/agenda|graphRequest/);
    expect(source).not.toMatch(/server\/ai|lib\/ai|fetch\s*\(/);
  });
});
