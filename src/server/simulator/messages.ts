import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { publish } from "@/server/events/bus";
import { onLeadActivity } from "@/server/inbox/lead-activity";

export class SimulatedInboundMessageError extends Error {
  constructor(
    public readonly code: "conversation_not_found" | "conversation_not_test"
  ) {
    super(
      code === "conversation_not_found"
        ? "No existe la conversación simulada"
        : "La conversación no es de prueba"
    );
    this.name = "SimulatedInboundMessageError";
  }
}

export type SimulatedInboundMessageResult =
  typeof schema.message.$inferSelect;

/**
 * Inserta una entrada local en una conversación de prueba y activa el mismo
 * flujo de actividad, SSE y agente que usa el inbox, sin pasar por un webhook
 * ni importar ninguna frontera de envío.
 */
export async function insertSimulatedInboundMessage(
  organizationId: string,
  conversationId: string,
  text: string
): Promise<SimulatedInboundMessageResult> {
  const db = getDb();
  const conversations = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const conversation = conversations[0];

  if (!conversation) {
    throw new SimulatedInboundMessageError("conversation_not_found");
  }
  if (!conversation.isTest) {
    throw new SimulatedInboundMessageError("conversation_not_test");
  }

  const now = new Date();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: null,
      direction: "in",
      type: "text",
      text,
      status: "delivered",
      waTimestamp: now,
    })
    .returning();
  const message = inserted[0];
  if (!message) throw new Error("No se pudo insertar el mensaje simulado");

  await db
    .update(schema.conversation)
    .set({
      lastInboundAt: now,
      lastMessageAt: now,
      unreadCount: sql`${schema.conversation.unreadCount} + 1`,
      updatedAt: now,
    })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversation.id),
        eq(schema.conversation.isTest, true)
      )
    );

  await onLeadActivity(organizationId, conversation.contactId, now);

  publish(organizationId, {
    type: "message.new",
    data: {
      conversationId: conversation.id,
      message: serializeSimulatedMessage(message),
    },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  if (conversation.aiEnabled && !conversation.handoffAt) {
    await maybeRunAgentTurn(conversation.id);
  }

  return message;
}

function serializeSimulatedMessage(
  message: typeof schema.message.$inferSelect
) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    text: message.text,
    status: message.status,
    error: message.error,
    aiGenerated: message.aiGenerated,
    origin: message.origin,
    media: null,
    createdAt: (message.waTimestamp ?? message.createdAt).toISOString(),
  };
}
