import { beforeEach, describe, expect, it, vi } from "vitest";

type Expr =
  | { op: "eq"; column: unknown; value: unknown }
  | {
      op: "scoped";
      organizationColumn: unknown;
      organizationId: string;
      conditions: Expr[];
    };

type ContactRow = {
  id: string;
  organizationId: string;
  channel: string;
  waIdentity: string;
  phone: string | null;
  archivedAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  contacts: [] as ContactRow[],
  contactInsertResult: [] as ContactRow[],
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  selectWheres: [] as Expr[],
  updates: [] as {
    table: unknown;
    values: Record<string, unknown>;
    where: Expr;
  }[],
  schema: Object.fromEntries(
    [
      "contact",
      "conversation",
      "message",
      "agentTestRun",
      "agentTestCase",
      "kbEntry",
      "agentProfile",
    ].map((table) => [
      table,
      new Proxy(
        { table },
        {
          get: (target, column) =>
            column === "table"
              ? target.table
              : `${target.table}.${String(column)}`,
        }
      ),
    ])
  ) as Record<string, Record<string, unknown>>,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Expr[]) => ({ op: "and", conditions }),
  asc: (column: unknown) => ({ op: "asc", column }),
  eq: (column: unknown, value: unknown): Expr => ({ op: "eq", column, value }),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (
    organizationColumn: unknown,
    organizationId: string,
    ...conditions: Expr[]
  ): Expr => ({
    op: "scoped",
    organizationColumn,
    organizationId,
    conditions,
  }),
}));

function matchesContact(contact: ContactRow, expression: Expr): boolean {
  if (expression.op !== "scoped") return false;
  if (contact.organizationId !== expression.organizationId) return false;

  return expression.conditions.every((condition) => {
    if (condition.op !== "eq") return false;
    const field = String(condition.column).split(".").at(-1);
    return contact[field as keyof ContactRow] === condition.value;
  });
}

vi.mock("@/lib/db", () => ({
  schema: mocks.schema,
  getDb: () => ({
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push({ table, values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () =>
            Promise.resolve(
              table === mocks.schema.contact
                ? mocks.contactInsertResult
                : [values]
            ),
          then: (resolve: (value: unknown) => void) =>
            Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    select: () => {
      let table: unknown;
      let where: Expr | null = null;
      const chain = {
        from: (selectedTable: unknown) => {
          table = selectedTable;
          return chain;
        },
        where: (expression: Expr) => {
          where = expression;
          mocks.selectWheres.push(expression);
          return chain;
        },
        limit: () =>
          Promise.resolve(
            table === mocks.schema.contact
              ? mocks.contacts.filter((contact) =>
                  where ? matchesContact(contact, where) : false
                )
              : []
          ),
        orderBy: () => Promise.resolve([]),
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: Expr) => {
          mocks.updates.push({ table, values, where });
          const matched = mocks.contacts.filter((contact) =>
            matchesContact(contact, where)
          );
          for (const contact of matched) {
            if (values.archivedAt instanceof Date) {
              contact.archivedAt = values.archivedAt;
            }
          }
          return {
            returning: () =>
              Promise.resolve(matched.map((contact) => ({ id: contact.id }))),
          };
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_new`,
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/ai/pipeline", () => ({ runAgentTurn: vi.fn() }));
vi.mock("@/server/ai/prompts", () => ({ renderKb: vi.fn(() => "") }));
vi.mock("@/server/lab/judge", () => ({
  computeScore: vi.fn(() => 0),
  judgeCase: vi.fn(),
}));

import {
  runConversation,
  upsertTestContact,
} from "@/server/lab/runner";
import type { Persona } from "@/server/lab/personas";

const persona: Persona = {
  key: "test",
  label: "Test",
  description: "Test",
  phone: "5210000000001",
  contactName: "[Prueba] Test",
  script: [],
};

describe("creación de contactos y conversaciones del Laboratorio", () => {
  beforeEach(() => {
    mocks.contacts.length = 0;
    mocks.contactInsertResult.length = 0;
    mocks.inserts.length = 0;
    mocks.selectWheres.length = 0;
    mocks.updates.length = 0;
  });

  it("crea el contacto archivado y la conversación con isTest=true", async () => {
    mocks.contactInsertResult.push({
      id: "contact_new",
      organizationId: "org_1",
      channel: "whatsapp",
      waIdentity: persona.phone,
      phone: persona.phone,
      archivedAt: new Date(),
    });

    await runConversation("org_1", persona);

    const contactInsert = mocks.inserts.find(
      ({ table }) => table === mocks.schema.contact
    );
    const conversationInsert = mocks.inserts.find(
      ({ table }) => table === mocks.schema.conversation
    );
    expect(contactInsert?.values.archivedAt).toBeInstanceOf(Date);
    expect(conversationInsert?.values).toMatchObject({
      organizationId: "org_1",
      contactId: "contact_new",
      isTest: true,
    });
  });

  it("resuelve por tenant, canal e identidad y archiva solo ese contacto", async () => {
    const samePhoneWrongIdentity: ContactRow = {
      id: "contact_wrong",
      organizationId: "org_1",
      channel: "whatsapp",
      waIdentity: "different-identity",
      phone: persona.phone,
      archivedAt: null,
    };
    const labContact: ContactRow = {
      id: "contact_lab",
      organizationId: "org_1",
      channel: "whatsapp",
      waIdentity: persona.phone,
      phone: null,
      archivedAt: null,
    };
    mocks.contacts.push(samePhoneWrongIdentity, labContact, {
      ...labContact,
      id: "contact_other_org",
      organizationId: "org_2",
    });

    const contactId = await upsertTestContact("org_1", persona);

    expect(contactId).toBe("contact_lab");
    expect(labContact.archivedAt).toBeInstanceOf(Date);
    expect(samePhoneWrongIdentity.archivedAt).toBeNull();
    expect(mocks.selectWheres[0]).toEqual({
      op: "scoped",
      organizationColumn: "contact.organizationId",
      organizationId: "org_1",
      conditions: [
        { op: "eq", column: "contact.channel", value: "whatsapp" },
        {
          op: "eq",
          column: "contact.waIdentity",
          value: persona.phone,
        },
      ],
    });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]?.where).toEqual({
      op: "scoped",
      organizationColumn: "contact.organizationId",
      organizationId: "org_1",
      conditions: [
        { op: "eq", column: "contact.id", value: "contact_lab" },
        { op: "eq", column: "contact.channel", value: "whatsapp" },
        {
          op: "eq",
          column: "contact.waIdentity",
          value: persona.phone,
        },
      ],
    });
  });
});
