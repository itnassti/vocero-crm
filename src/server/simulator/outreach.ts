import { eq } from "drizzle-orm";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { loadAgentPromptContext } from "@/server/ai/context";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import {
  persistSimulatedAiOutbound,
  SimulatedAiOutboundError,
} from "@/server/simulator/ai-outbound";

export const simulatedFirstOutreachActionSchema = z
  .object({
    action: z.literal("reply"),
    text: z.string().trim().min(1).max(4096),
  })
  .strict();

export type SimulatedOutreachErrorCode =
  | "conversation_not_found"
  | "conversation_not_test"
  | "ai_disabled"
  | "handoff_active"
  | "conversation_not_empty"
  | "profile_not_found"
  | "generation_failed";

export class SimulatedOutreachError extends Error {
  constructor(readonly code: SimulatedOutreachErrorCode) {
    super(code);
  }
}

type OutreachMessage = typeof schema.message.$inferSelect;

const globalForOutreach = globalThis as unknown as {
  __simulatedOutreachLocks?: Map<string, Promise<OutreachMessage>>;
};

function outreachLocks(): Map<string, Promise<OutreachMessage>> {
  if (!globalForOutreach.__simulatedOutreachLocks) {
    globalForOutreach.__simulatedOutreachLocks = new Map();
  }
  return globalForOutreach.__simulatedOutreachLocks;
}

export async function generateSimulatedFirstOutreach(
  organizationId: string,
  conversationId: string
): Promise<OutreachMessage> {
  const key = `${organizationId}:${conversationId}`;
  const locks = outreachLocks();
  const running = locks.get(key);
  if (running) return running;

  const task = generateLocked(organizationId, conversationId);
  locks.set(key, task);
  try {
    return await task;
  } finally {
    if (locks.get(key) === task) locks.delete(key);
  }
}

async function generateLocked(
  organizationId: string,
  conversationId: string
): Promise<OutreachMessage> {
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
  if (!conversation) throw new SimulatedOutreachError("conversation_not_found");
  if (!conversation.isTest) {
    throw new SimulatedOutreachError("conversation_not_test");
  }
  if (!conversation.aiEnabled) {
    throw new SimulatedOutreachError("ai_disabled");
  }
  if (conversation.handoffAt) {
    throw new SimulatedOutreachError("handoff_active");
  }

  // Se comprueba dentro del lock antes de tocar el proveedor.
  const existingMessages = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversation.id)
      )
    )
    .limit(1);
  if (existingMessages.length > 0) {
    throw new SimulatedOutreachError("conversation_not_empty");
  }

  const profiles = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profiles[0];
  if (!profile) throw new SimulatedOutreachError("profile_not_found");

  // El toggle global no bloquea conversaciones isTest, igual que en el Lab.
  const promptContext = await loadAgentPromptContext(
    organizationId,
    conversation.contactId
  );
  const systemPrompt = buildAgentSystemPrompt({
    profile,
    ...promptContext,
    agenda: false,
    turnMode: "first_outreach",
  });
  const result = await chatJson(simulatedFirstOutreachActionSchema, [
    { role: "system", content: systemPrompt },
  ]);
  if (!result.ok) {
    throw new SimulatedOutreachError("generation_failed");
  }

  try {
    return await persistSimulatedAiOutbound(
      organizationId,
      conversation.id,
      result.data.text,
      { requireEmptyHistory: true }
    );
  } catch (error) {
    if (error instanceof SimulatedAiOutboundError) {
      throw new SimulatedOutreachError(error.code);
    }
    throw error;
  }
}
