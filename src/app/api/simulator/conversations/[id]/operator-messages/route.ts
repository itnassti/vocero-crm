import { apiError, parseBody, withAuth } from "@/lib/api";
import { simulatedMessageBodySchema } from "@/server/simulator/message-contract";
import {
  insertSimulatedOperatorMessage,
  SimulatedOperatorMessageError,
} from "@/server/simulator/operator-messages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, simulatedMessageBodySchema);
  if (!body.ok) {
    return apiError(
      400,
      "invalid_body",
      "La respuesta simulada del operador no es válida"
    );
  }

  try {
    const message = await insertSimulatedOperatorMessage(
      session.organizationId,
      id,
      body.data.text
    );
    return Response.json({ messageId: message.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SimulatedOperatorMessageError) {
      if (error.code === "conversation_not_found") {
        return apiError(404, "not_found", "Conversación simulada no encontrada");
      }
      return apiError(
        409,
        "conversation_not_test",
        "La conversación no admite respuestas simuladas"
      );
    }

    console.error(
      "[api/simulator/conversations/operator-messages] no se pudo insertar la respuesta"
    );
    return apiError(
      500,
      "internal",
      "No se pudo insertar la respuesta simulada"
    );
  }
});
