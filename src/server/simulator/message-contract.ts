import { z } from "zod";
import type { schema } from "@/lib/db";

export const simulatedMessageBodySchema = z
  .object({
    text: z.string().trim().min(1).max(4096),
  })
  .strict();

export function serializeSimulatedMessage(
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
