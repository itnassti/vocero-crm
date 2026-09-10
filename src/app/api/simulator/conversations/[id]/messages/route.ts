import { apiError, parseBody, withAuth } from "@/lib/api";
import { simulatedMessageBodySchema } from "@/server/simulator/message-contract";
import {
  insertSimulatedInboundMessage,
  SimulatedInboundMessageError,
} from "@/server/simulator/messages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, simulatedMessageBodySchema);
  if (!body.ok) {
    return apiError(400, "invalid_body", "El mensaje simulado no es válido");
  }

  try {
    const message = await insertSimulatedInboundMessage(
      session.organizationId,
      id,
      body.data.text
    );
    return Response.json({ messageId: message.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SimulatedInboundMessageError) {
      if (error.code === "conversation_not_found") {
        return apiError(404, "not_found", "Conversación simulada no encontrada");
      }
      return apiError(
        409,
        "conversation_not_test",
        "La conversación no admite mensajes simulados"
      );
    }

    console.error(
      "[api/simulator/conversations/messages] no se pudo insertar el mensaje"
    );
    return apiError(500, "internal", "No se pudo insertar el mensaje simulado");
  }
});
