import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getContactById, getContactStage } from "@/server/contacts";
import type { KnownLeadContext } from "@/server/ai/prompts";

type KbEntry = typeof schema.kbEntry.$inferSelect;

export type AgentPromptContext = {
  kb: KbEntry[];
  stages: { id: string; name: string }[];
  leadContext: KnownLeadContext;
};

/** Fuentes compartidas por el turno normal y el primer outreach simulado. */
export async function loadAgentPromptContext(
  organizationId: string,
  contactId: string
): Promise<AgentPromptContext> {
  const db = getDb();
  const contact = await getContactById(organizationId, contactId);
  const currentLead = await getContactStage(organizationId, contactId);
  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  return {
    kb,
    stages,
    leadContext: {
      name: contact?.name,
      source: contact?.source,
      ficha: contact?.ficha,
      stageName: currentLead?.stage.name,
    },
  };
}
