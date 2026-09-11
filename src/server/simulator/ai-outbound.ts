import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { serializeSimulatedMessage } from "@/server/simulator/message-contract";

export type SimulatedAiOutboundErrorCode =
  | "conversation_not_found"
  | "conversation_not_test"
  | "ai_disabled"
  | "handoff_active"
  | "conversation_not_empty";

export class SimulatedAiOutboundError extends Error {
  constructor(readonly code: SimulatedAiOutboundErrorCode) {
    super(code);
    this.name = "SimulatedAiOutboundError";
  }
}

type PersistOptions = { requireEmptyHistory?: boolean };

/** Persiste una salida IA local. Esta frontera rechaza conversaciones reales. */
export async function persistSimulatedAiOutbound(
  organizationId: string,
  conversationId: string,
  text: string,
  options: PersistOptions = {}
): Promise<typeof schema.message.$inferSelect> {
  const db = getDb();
  const message = await db.transaction(async (tx) => {
    // Todos los escritores simulados bloquean esta misma fila antes de insertar.
    const conversations = await tx
      .select()
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversationId)
        )
      )
      .for("update")
      .limit(1);
    const conversation = conversations[0];
    if (!conversation) {
      throw new SimulatedAiOutboundError("conversation_not_found");
    }
    if (!conversation.isTest) {
      throw new SimulatedAiOutboundError("conversation_not_test");
    }

    if (options.requireEmptyHistory) {
      if (!conversation.aiEnabled) {
        throw new SimulatedAiOutboundError("ai_disabled");
      }
      if (conversation.handoffAt) {
        throw new SimulatedAiOutboundError("handoff_active");
      }
      const existing = await tx
        .select({ id: schema.message.id })
        .from(schema.message)
        .where(
          scoped(
            schema.message.organizationId,
            organizationId,
            eq(schema.message.conversationId, conversationId)
          )
        )
        .limit(1);
      if (existing.length > 0) {
        throw new SimulatedAiOutboundError("conversation_not_empty");
      }
    }

    const inserted = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: null,
        direction: "out",
        type: "text",
        text,
        status: "sent",
        aiGenerated: true,
        origin: "ai",
      })
      .returning();
    const insertedMessage = inserted[0];
    if (!insertedMessage) {
      throw new Error("No se pudo persistir la respuesta simulada");
    }

    const now = new Date();
    await tx
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.isTest, true)
        )
      );
    return insertedMessage;
  });

  // Fuera de la transacción: solo se anuncia una fila ya confirmada.
  publish(organizationId, {
    type: "message.new",
    data: {
      conversationId,
      message: serializeSimulatedMessage(message),
    },
  });

  return message;
}
