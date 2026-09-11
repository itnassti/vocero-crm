import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { serializeSimulatedMessage } from "@/server/simulator/message-contract";

export class SimulatedOperatorMessageError extends Error {
  constructor(
    public readonly code: "conversation_not_found" | "conversation_not_test"
  ) {
    super(
      code === "conversation_not_found"
        ? "No existe la conversación simulada"
        : "La conversación no es de prueba"
    );
    this.name = "SimulatedOperatorMessageError";
  }
}

export type SimulatedOperatorMessageResult =
  typeof schema.message.$inferSelect;

/**
 * Persiste una respuesta humana solo en BD para una conversación simulada.
 * Replica el takeover de una respuesta manual: pausa la IA con
 * `manual_reply` cuando todavía no hay handoff, sin importar ningún sender.
 */
export async function insertSimulatedOperatorMessage(
  organizationId: string,
  conversationId: string,
  text: string
): Promise<SimulatedOperatorMessageResult> {
  const db = getDb();
  const { conversation, message } = await db.transaction(async (tx) => {
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
      throw new SimulatedOperatorMessageError("conversation_not_found");
    }
    if (!conversation.isTest) {
      throw new SimulatedOperatorMessageError("conversation_not_test");
    }

    const normalizedText = text.trim();
    const now = new Date();
    const inserted = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId: conversation.id,
        waMessageId: null,
        direction: "out",
        type: "text",
        text: normalizedText,
        status: "sent",
        aiGenerated: false,
        origin: "operator",
      })
      .returning();
    const message = inserted[0];
    if (!message) {
      throw new Error("No se pudo insertar la respuesta simulada del operador");
    }

    await tx
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversation.id),
          eq(schema.conversation.isTest, true)
        )
      );

    if (conversation.handoffAt === null) {
      await tx
        .update(schema.conversation)
        .set({
          aiEnabled: false,
          handoffAt: now,
          handoffReason: "manual_reply",
          updatedAt: now,
        })
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            eq(schema.conversation.id, conversation.id),
            eq(schema.conversation.isTest, true),
            sql`${schema.conversation.handoffAt} is null`
          )
        );
    }

    return { conversation, message };
  });

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

  return message;
}
