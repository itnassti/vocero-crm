import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { normalizeFicha } from "@/server/bot/ficha";
import { createLeadForContact } from "@/server/inbox/lead-activity";

export type SimulatedLeadInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  ageRange: string;
  country: string;
  goal: string;
  obstacles: string;
  willingToInvest: boolean;
  source: "anuncio" | "organico" | "referido" | "conocido" | "otro";
  platform: string;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  placement?: string | null;
};

export type SimulatedLeadResult = {
  contact: typeof schema.contact.$inferSelect;
  lead: { id: string; stageId: string };
  conversation: typeof schema.conversation.$inferSelect;
};

const rollbackFailures = new WeakMap<object, unknown>();

/** Devuelve el fallo secundario de compensación, si el error principal lo tuvo. */
export function getSimulatedLeadRollbackError(error: unknown): unknown {
  return isObject(error) ? rollbackFailures.get(error) : undefined;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Crea el agregado mínimo de la beta sin tocar ningún canal externo.
 *
 * `organizationId` viene de la sesión autenticada del futuro llamador. La
 * identidad `sim:<contactId>` nunca se interpreta como teléfono o BSUID, y
 * `isTest` mantiene activos los guardrails que impiden envíos reales.
 *
 * El helper canónico de leads abre su propia conexión y no acepta una
 * transacción. Para conservar su selección de etapa y la bitácora, esta
 * operación usa compensación: si el lead o la conversación fallan, elimina el
 * contacto recién creado y el cascade retira lo que alcanzara a persistirse.
 */
export async function createSimulatedLead(
  organizationId: string,
  input: SimulatedLeadInput
): Promise<SimulatedLeadResult> {
  const db = getDb();
  const contactId = newId("contact");
  const fichaInput: Record<string, unknown> = {
    ageRange: input.ageRange,
    country: input.country,
    goal: input.goal,
    obstacles: input.obstacles,
    willingToInvest: input.willingToInvest,
    platform: input.platform,
  };

  for (const [key, value] of Object.entries({
    email: input.email,
    campaignId: input.campaignId,
    adsetId: input.adsetId,
    adId: input.adId,
    placement: input.placement,
  })) {
    if (value !== null && value !== undefined) fichaInput[key] = value;
  }

  const insertedContacts = await db
    .insert(schema.contact)
    .values({
      id: contactId,
      organizationId,
      waIdentity: `sim:${contactId}`,
      waUserId: null,
      channel: "whatsapp",
      name: input.name.trim(),
      nameSource: "manual",
      phone: input.phone?.trim() || null,
      source: input.source,
      ficha: normalizeFicha(fichaInput),
      archivedAt: null,
    })
    .returning();
  const contact = insertedContacts[0];
  if (!contact) throw new Error("No se pudo crear el contacto simulado");

  try {
    // Sin stageId: el helper selecciona la primera etapa abierta por position.
    const lead = await createLeadForContact({
      organizationId,
      contactId,
      source: "sistema",
    });
    if (!lead) {
      throw new Error("No hay una etapa abierta para el lead simulado");
    }

    const insertedConversations = await db
      .insert(schema.conversation)
      .values({
        id: newId("conversation"),
        organizationId,
        contactId,
        channel: "whatsapp",
        isTest: true,
        aiEnabled: true,
      })
      .returning();
    const conversation = insertedConversations[0];
    if (!conversation) {
      throw new Error("No se pudo crear la conversación simulada");
    }

    return { contact, lead, conversation };
  } catch (error) {
    try {
      await db
        .delete(schema.contact)
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            eq(schema.contact.id, contactId)
          )
        );
    } catch (rollbackError) {
      // Conserva el error de creación como principal. El detalle secundario
      // queda disponible para diagnóstico interno, pero nunca se vuelca al log
      // porque un error del driver puede contener consultas o datos sensibles.
      if (isObject(error)) rollbackFailures.set(error, rollbackError);
      console.error(
        "[simulator] falló el rollback compensatorio; se conserva el error original"
      );
    }
    throw error;
  }
}
