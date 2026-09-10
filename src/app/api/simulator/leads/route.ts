import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  createSimulatedLead,
  SimulatedLeadCreationError,
  simulatedLeadInputSchema,
} from "@/server/simulator/leads";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, simulatedLeadInputSchema);
  if (!body.ok) {
    return apiError(400, "invalid_body", "El payload del lead simulado no es válido");
  }

  try {
    const result = await createSimulatedLead(session.organizationId, body.data);
    return Response.json(
      {
        contactId: result.contact.id,
        leadId: result.lead.id,
        conversationId: result.conversation.id,
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof SimulatedLeadCreationError &&
      error.code === "no_open_stage"
    ) {
      return apiError(
        409,
        "no_open_stage",
        "El pipeline no tiene una etapa abierta para el lead simulado"
      );
    }

    console.error("[api/simulator/leads] no se pudo crear el lead simulado");
    return apiError(500, "internal", "No se pudo crear el lead simulado");
  }
});
