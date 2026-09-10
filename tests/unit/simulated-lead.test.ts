import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryExpr =
  | { op: "eq"; column: unknown; value: unknown }
  | { op: "and"; parts: unknown[] }
  | { op: "asc"; column: unknown };

const mocks = vi.hoisted(() => ({
  createLeadForContact: vi.fn(),
  recordLeadCreated: vi.fn(async () => undefined),
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  deletes: [] as { table: unknown; where: unknown }[],
  selectQueue: [] as unknown[][],
  selectCalls: [] as { where?: unknown; orderBy?: unknown }[],
  events: [] as string[],
  conversationError: null as unknown,
  rollbackError: null as unknown,
  schema: {
    contact: { id: "contact.id", organizationId: "contact.organizationId" },
    conversation: { id: "conversation.id" },
    pipelineStage: {
      id: "pipelineStage.id",
      organizationId: "pipelineStage.organizationId",
      kind: "pipelineStage.kind",
      position: "pipelineStage.position",
    },
    lead: {
      id: "lead.id",
      organizationId: "lead.organizationId",
      contactId: "lead.contactId",
      stageId: "lead.stageId",
      position: "lead.position",
    },
  },
}));

vi.mock("drizzle-orm", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    strings,
    values,
  });
  return {
    and: (...parts: unknown[]): QueryExpr => ({ op: "and", parts }),
    asc: (column: unknown): QueryExpr => ({ op: "asc", column }),
    eq: (column: unknown, value: unknown): QueryExpr => ({
      op: "eq",
      column,
      value,
    }),
    sql,
  };
});

vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => {
    if (kind === "contact") return "ct_simulated";
    if (kind === "conversation") return "cv_simulated";
    if (kind === "lead") return "ld_simulated";
    return `${kind}_simulated`;
  },
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (
    organizationColumn: unknown,
    organizationId: string,
    ...conditions: unknown[]
  ) => ({ organizationColumn, organizationId, conditions }),
}));

vi.mock("@/server/inbox/lead-activity", () => ({
  createLeadForContact: mocks.createLeadForContact,
}));

vi.mock("@/server/leads/stage-history", () => ({
  recordLeadCreated: mocks.recordLeadCreated,
}));

function selectChain(rows: unknown[]) {
  const call: { where?: unknown; orderBy?: unknown } = {};
  mocks.selectCalls.push(call);
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = (where: unknown) => {
    call.where = where;
    return chain;
  };
  chain.orderBy = (orderBy: unknown) => {
    call.orderBy = orderBy;
    return chain;
  };
  chain.limit = () => Promise.resolve(rows);
  chain.then = (
    resolve: (value: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/db", () => ({
  schema: mocks.schema,
  getDb: () => ({
    select: () => selectChain(mocks.selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push({ table, values });
        if (table === mocks.schema.contact) mocks.events.push("contact");
        if (table === mocks.schema.conversation) mocks.events.push("conversation");
        if (table === mocks.schema.lead) mocks.events.push("lead");
        const returning = async () => {
          if (table === mocks.schema.conversation && mocks.conversationError) {
            throw mocks.conversationError;
          }
          if (table === mocks.schema.lead) {
            return [{ id: values.id, stageId: values.stageId }];
          }
          return [values];
        };
        const insertChain = {
          onConflictDoNothing: () => insertChain,
          returning,
        };
        return insertChain;
      },
    }),
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        mocks.events.push("rollback");
        mocks.deletes.push({ table, where });
        if (mocks.rollbackError) throw mocks.rollbackError;
      },
    }),
  }),
}));

const baseInput = {
  name: "Ana Simulada",
  phone: null,
  email: "  ana@example.com  ",
  ageRange: " 25-34 ",
  country: " MX ",
  goal: " Mejorar hábitos ",
  obstacles: " Falta de tiempo ",
  willingToInvest: true,
  source: "anuncio" as const,
  platform: " instagram ",
  campaignId: " cmp_1 ",
  adsetId: " set_1 ",
  adId: " ad_1 ",
  placement: " stories ",
};

const rollbackScope = {
  organizationColumn: "contact.organizationId",
  organizationId: "org_1",
  conditions: [{ op: "eq", column: "contact.id", value: "ct_simulated" }],
};

describe("createSimulatedLead", () => {
  beforeEach(() => {
    mocks.createLeadForContact.mockReset();
    mocks.createLeadForContact.mockImplementation(async () => {
      mocks.events.push("lead");
      return { id: "ld_simulated", stageId: "stg_first_open" };
    });
    mocks.recordLeadCreated.mockClear();
    mocks.inserts.length = 0;
    mocks.deletes.length = 0;
    mocks.selectQueue.length = 0;
    mocks.selectCalls.length = 0;
    mocks.events.length = 0;
    mocks.conversationError = null;
    mocks.rollbackError = null;
  });

  it("crea el agregado con scoping, identidad, ficha y flags de sandbox", async () => {
    const { createSimulatedLead } = await import("@/server/simulator/leads");
    const result = await createSimulatedLead("org_1", baseInput);

    expect(result.contact).toMatchObject({
      id: "ct_simulated",
      organizationId: "org_1",
      waIdentity: "sim:ct_simulated",
      ficha: {
        email: "ana@example.com",
        ageRange: "25-34",
        country: "MX",
        goal: "Mejorar hábitos",
        obstacles: "Falta de tiempo",
        willingToInvest: true,
        platform: "instagram",
        campaignId: "cmp_1",
        adsetId: "set_1",
        adId: "ad_1",
        placement: "stories",
      },
    });
    expect(result.conversation).toMatchObject({
      id: "cv_simulated",
      organizationId: "org_1",
      contactId: "ct_simulated",
      isTest: true,
      aiEnabled: true,
    });
    expect(mocks.createLeadForContact).toHaveBeenCalledWith({
      organizationId: "org_1",
      contactId: "ct_simulated",
      source: "sistema",
    });
    expect(
      Object.hasOwn(mocks.createLeadForContact.mock.calls[0]![0], "stageId")
    ).toBe(false);
  });

  it("omite de ficha los opcionales null o undefined", async () => {
    const { createSimulatedLead } = await import("@/server/simulator/leads");
    const result = await createSimulatedLead("org_1", {
      ...baseInput,
      email: null,
      campaignId: null,
      adsetId: undefined,
      adId: null,
      placement: undefined,
    });

    expect(result.contact.ficha).toEqual({
      ageRange: "25-34",
      country: "MX",
      goal: "Mejorar hábitos",
      obstacles: "Falta de tiempo",
      willingToInvest: true,
      platform: "instagram",
    });
  });

  it("compensa exactamente el contacto creado cuando no hay stage abierta", async () => {
    mocks.createLeadForContact.mockResolvedValueOnce(null);
    const { createSimulatedLead } = await import("@/server/simulator/leads");

    await expect(createSimulatedLead("org_1", baseInput)).rejects.toThrow(
      "No hay una etapa abierta"
    );
    expect(mocks.deletes).toEqual([
      { table: mocks.schema.contact, where: rollbackScope },
    ]);
    expect(mocks.events).toEqual(["contact", "rollback"]);
  });

  it("compensa contacto y lead si falla la conversación", async () => {
    const originalError = new Error("conversation failed");
    mocks.conversationError = originalError;
    const { createSimulatedLead } = await import("@/server/simulator/leads");

    const caught = await createSimulatedLead("org_1", baseInput).catch(
      (error: unknown) => error
    );
    expect(caught).toBe(originalError);
    expect(mocks.deletes).toEqual([
      { table: mocks.schema.contact, where: rollbackScope },
    ]);
    expect(mocks.events).toEqual([
      "contact",
      "lead",
      "conversation",
      "rollback",
    ]);
  });

  it("preserva el error original y registra el fallo secundario del rollback", async () => {
    const originalError = new Error("conversation failed");
    const rollbackError = new Error("delete failed with sensitive detail");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.conversationError = originalError;
    mocks.rollbackError = rollbackError;
    const { createSimulatedLead, getSimulatedLeadRollbackError } = await import(
      "@/server/simulator/leads"
    );

    const caught = await createSimulatedLead("org_1", baseInput).catch(
      (error: unknown) => error
    );
    expect(caught).toBe(originalError);
    expect(getSimulatedLeadRollbackError(caught)).toBe(rollbackError);
    expect(log).toHaveBeenCalledWith(
      "[simulator] falló el rollback compensatorio; se conserva el error original"
    );
    expect(log.mock.calls.flat().join(" ")).not.toContain("sensitive detail");
    log.mockRestore();
  });

  it("el helper canónico filtra open y ordena por position", async () => {
    mocks.selectQueue.push([{ id: "stg_first_open" }], [{ max: 4 }]);
    const { createLeadForContact } = await vi.importActual<
      typeof import("@/server/inbox/lead-activity")
    >("@/server/inbox/lead-activity");

    const result = await createLeadForContact({
      organizationId: "org_1",
      contactId: "ct_simulated",
      source: "sistema",
    });

    expect(mocks.selectCalls[0]).toEqual({
      where: {
        op: "and",
        parts: [
          {
            op: "eq",
            column: "pipelineStage.organizationId",
            value: "org_1",
          },
          { op: "eq", column: "pipelineStage.kind", value: "open" },
        ],
      },
      orderBy: { op: "asc", column: "pipelineStage.position" },
    });
    expect(result).toEqual({ id: "ld_simulated", stageId: "stg_first_open" });
  });
});
