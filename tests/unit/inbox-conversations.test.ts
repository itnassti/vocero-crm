import { beforeEach, describe, expect, it, vi } from "vitest";

type Expr =
  | { op: "eq"; column: unknown; value: unknown }
  | { op: "gt"; column: unknown; value: Date }
  | { op: "isNull"; column: unknown }
  | { op: "sql"; strings: string[]; values: unknown[] }
  | { op: "desc"; value: Expr }
  | {
      op: "scoped";
      organizationColumn: unknown;
      organizationId: string;
      conditions: Expr[];
    };

type FakeConversation = {
  id: string;
  organizationId: string;
  contactId: string;
  isTest: boolean;
  channel: "whatsapp";
  channelThreadRef: null;
  aiEnabled: boolean;
  handoffAt: Date | null;
  handoffReason: null;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type FakeContact = {
  id: string;
  organizationId: string;
  channel: "whatsapp";
  waIdentity: string;
  phone: string | null;
  waUserId: null;
  name: string;
  nameSource: "manual";
  notes: null;
  ficha: null;
  source: null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeRow = {
  conversation: FakeConversation;
  contact: FakeContact;
  preview: string | null;
  stageName: string | null;
};

const mocks = vi.hoisted(() => ({
  rows: [] as FakeRow[],
  where: null as Expr | null,
  orderBy: null as Expr | null,
  schema: {
    conversation: {
      id: "conversation.id",
      organizationId: "conversation.organizationId",
      contactId: "conversation.contactId",
      isTest: "conversation.isTest",
      updatedAt: "conversation.updatedAt",
      lastMessageAt: "conversation.lastMessageAt",
      createdAt: "conversation.createdAt",
    },
    contact: {
      id: "contact.id",
      archivedAt: "contact.archivedAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Expr[]) => ({ op: "and", conditions }),
  desc: (value: Expr): Expr => ({ op: "desc", value }),
  eq: (column: unknown, value: unknown): Expr => ({ op: "eq", column, value }),
  gt: (column: unknown, value: Date): Expr => ({ op: "gt", column, value }),
  isNull: (column: unknown): Expr => ({ op: "isNull", column }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]): Expr => ({
    op: "sql",
    strings: [...strings],
    values,
  }),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (
    organizationColumn: unknown,
    organizationId: string,
    ...conditions: (Expr | undefined)[]
  ): Expr => ({
    op: "scoped",
    organizationColumn,
    organizationId,
    conditions: conditions.filter((condition): condition is Expr => Boolean(condition)),
  }),
}));

function matches(row: FakeRow, where: Expr | null): boolean {
  if (!where || where.op !== "scoped") return false;
  if (row.conversation.organizationId !== where.organizationId) return false;

  return where.conditions.every((condition) => {
    if (condition.op === "isNull") {
      return (
        condition.column === mocks.schema.contact.archivedAt &&
        row.contact.archivedAt === null
      );
    }
    if (condition.op === "gt") {
      return (
        condition.column === mocks.schema.conversation.updatedAt &&
        row.conversation.updatedAt > condition.value
      );
    }
    if (condition.op === "eq" && condition.column === mocks.schema.conversation.isTest) {
      return row.conversation.isTest === condition.value;
    }
    return false;
  });
}

vi.mock("@/lib/db", () => ({
  schema: mocks.schema,
  getDb: () => ({
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (where: Expr) => {
          mocks.where = where;
          return chain;
        },
        orderBy: (orderBy: Expr) => {
          mocks.orderBy = orderBy;
          return Promise.resolve(
            mocks.rows
              .filter((row) => matches(row, mocks.where))
              .sort((a, b) => {
                const aAt = a.conversation.lastMessageAt ?? a.conversation.createdAt;
                const bAt = b.conversation.lastMessageAt ?? b.conversation.createdAt;
                return bAt.getTime() - aAt.getTime();
              })
          );
        },
      };
      return chain;
    },
  }),
}));

vi.mock("@/server/inbox/window", () => ({
  isWindowOpen: () => true,
  windowRemainingMs: () => 123,
}));

import {
  listConversations,
  serializeConversation,
} from "@/server/inbox/queries";

function row(input: {
  id: string;
  organizationId?: string;
  isTest?: boolean;
  archivedAt?: Date | null;
  unreadCount?: number;
  lastMessageAt: Date;
}): FakeRow {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    conversation: {
      id: input.id,
      organizationId: input.organizationId ?? "org_active",
      contactId: `ct_${input.id}`,
      isTest: input.isTest ?? false,
      channel: "whatsapp",
      channelThreadRef: null,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: input.lastMessageAt,
      lastMessageAt: input.lastMessageAt,
      unreadCount: input.unreadCount ?? 0,
      createdAt,
      updatedAt: input.lastMessageAt,
    },
    contact: {
      id: `ct_${input.id}`,
      organizationId: input.organizationId ?? "org_active",
      channel: "whatsapp",
      waIdentity: `sim:ct_${input.id}`,
      phone: null,
      waUserId: null,
      name: input.id,
      nameSource: "manual",
      notes: null,
      ficha: null,
      source: null,
      archivedAt: input.archivedAt ?? null,
      createdAt,
      updatedAt: createdAt,
    },
    preview: `preview ${input.id}`,
    stageName: "Nuevo",
  };
}

describe("conversaciones visibles en el inbox", () => {
  beforeEach(() => {
    mocks.rows.length = 0;
    mocks.where = null;
    mocks.orderBy = null;
  });

  it("muestra reales y simuladas activas, y oculta contactos archivados", async () => {
    mocks.rows.push(
      row({
        id: "real_active",
        lastMessageAt: new Date("2026-01-02T10:00:00.000Z"),
        unreadCount: 3,
      }),
      row({
        id: "simulated_active",
        isTest: true,
        lastMessageAt: new Date("2026-01-02T11:00:00.000Z"),
        unreadCount: 7,
      }),
      row({
        id: "lab_archived",
        isTest: true,
        archivedAt: new Date("2026-01-02T12:00:00.000Z"),
        lastMessageAt: new Date("2026-01-02T12:00:00.000Z"),
      }),
      row({
        id: "real_archived",
        archivedAt: new Date("2026-01-02T13:00:00.000Z"),
        lastMessageAt: new Date("2026-01-02T13:00:00.000Z"),
      }),
      row({
        id: "other_org",
        organizationId: "org_other",
        lastMessageAt: new Date("2026-01-02T14:00:00.000Z"),
      })
    );

    const result = await listConversations("org_active");

    expect(result.map((conversation) => conversation.id)).toEqual([
      "simulated_active",
      "real_active",
    ]);
    expect(result.map((conversation) => conversation.unreadCount)).toEqual([7, 3]);
    expect(mocks.where).toMatchObject({
      op: "scoped",
      organizationId: "org_active",
      conditions: [{ op: "isNull", column: "contact.archivedAt" }],
    });
    expect(mocks.orderBy).toMatchObject({
      op: "desc",
      value: {
        op: "sql",
        values: ["conversation.lastMessageAt", "conversation.createdAt"],
      },
    });
  });

  it("conserva el filtro incremental por updatedAt", async () => {
    mocks.rows.push(
      row({
        id: "old",
        lastMessageAt: new Date("2026-01-02T09:00:00.000Z"),
      }),
      row({
        id: "new",
        isTest: true,
        lastMessageAt: new Date("2026-01-02T11:00:00.000Z"),
      })
    );

    const result = await listConversations(
      "org_active",
      new Date("2026-01-02T10:00:00.000Z")
    );

    expect(result.map((conversation) => conversation.id)).toEqual(["new"]);
  });

  it.each([
    [false, false],
    [true, true],
  ])("serializa isTest=%s como simulated=%s", (isTest, simulated) => {
    const input = row({
      id: isTest ? "simulated" : "real",
      isTest,
      lastMessageAt: new Date("2026-01-02T10:00:00.000Z"),
    });

    const dto = serializeConversation(
      input.conversation as Parameters<typeof serializeConversation>[0],
      input.contact as Parameters<typeof serializeConversation>[1]
    );

    expect(dto.simulated).toBe(simulated);
  });
});
