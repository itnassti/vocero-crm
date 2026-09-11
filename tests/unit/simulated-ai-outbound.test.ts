import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversations: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as { values: Record<string, unknown>; where: unknown }[],
  publish: vi.fn(),
  schema: {
    message: {
      id: "message.id",
      organizationId: "message.organizationId",
      conversationId: "message.conversationId",
    },
    conversation: {
      organizationId: "conversation.organizationId",
      id: "conversation.id",
      isTest: "conversation.isTest",
    },
  },
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "msg_outreach" }));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
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
  schema: mocks.schema,
  getDb: () => {
    const db = {
    transaction: (work: (tx: unknown) => unknown) => work(db),
    select: () => {
      let table: unknown;
      const chain = {
        from: (value: unknown) => {
          table = value;
          return chain;
        },
        where: () => chain,
        for: () => chain,
        limit: () =>
          Promise.resolve(
            table === mocks.schema.conversation
              ? mocks.conversations
              : mocks.messages
          ),
      };
      return chain;
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push(values);
        return {
          returning: () => Promise.resolve([{
            ...values,
            error: null,
            waTimestamp: null,
            createdAt: new Date("2026-09-11T10:00:00.000Z"),
          }]),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: unknown) => {
          mocks.updates.push({ values, where });
          return Promise.resolve();
        },
      }),
    }),
    };
    return db;
  },
}));

import { persistSimulatedAiOutbound } from "@/server/simulator/ai-outbound";

describe("persistSimulatedAiOutbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations.length = 0;
    mocks.messages.length = 0;
    mocks.inserts.length = 0;
    mocks.updates.length = 0;
  });

  it("consulta la DB y rechaza una conversación real antes de escribir", async () => {
    mocks.conversations.push({
      id: "cv_real",
      organizationId: "org_1",
      isTest: false,
      aiEnabled: true,
      handoffAt: null,
    });

    await expect(
      persistSimulatedAiOutbound("org_1", "cv_real", "Hola")
    ).rejects.toMatchObject({ code: "conversation_not_test" });

    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("persiste y publica exactamente una salida IA local con DTO completo", async () => {
    mocks.conversations.push({
      id: "cv_test",
      organizationId: "org_1",
      isTest: true,
      aiEnabled: true,
      handoffAt: null,
    });
    // Una respuesta IA normal no exige historial vacío.
    mocks.messages.push({
      id: "msg_inbound",
      organizationId: "org_1",
      conversationId: "cv_test",
    });
    const message = await persistSimulatedAiOutbound(
      "org_1",
      "cv_test",
      "Hola, ¿cómo estás?"
    );

    expect(mocks.inserts).toEqual([{
      id: "msg_outreach",
      organizationId: "org_1",
      conversationId: "cv_test",
      waMessageId: null,
      direction: "out",
      type: "text",
      text: "Hola, ¿cómo estás?",
      status: "sent",
      aiGenerated: true,
      origin: "ai",
    }]);
    expect(message).toMatchObject(mocks.inserts[0]!);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      values: { lastMessageAt: expect.any(Date), updatedAt: expect.any(Date) },
      where: {
        op: "scoped",
        organizationId: "org_1",
        conditions: [
          { op: "eq", column: "conversation.id", value: "cv_test" },
          { op: "eq", column: "conversation.isTest", value: true },
        ],
      },
    });
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledWith("org_1", {
      type: "message.new",
      data: {
        conversationId: "cv_test",
        message: {
          id: "msg_outreach",
          conversationId: "cv_test",
          direction: "out",
          type: "text",
          text: "Hola, ¿cómo estás?",
          status: "sent",
          error: null,
          aiGenerated: true,
          origin: "ai",
          media: null,
          createdAt: "2026-09-11T10:00:00.000Z",
        },
      },
    });
  });

  it("no importa ninguna frontera externa", () => {
    const source = readFileSync(
      new URL("../../src/server/simulator/ai-outbound.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/sendText|graphRequest|@\/lib\/meta|whatsapp|agenda/iu);
  });
});
