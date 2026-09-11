import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { serializeSimulatedMessage } from "@/server/simulator/message-contract";
import {
  generateSimulatedFirstOutreach,
  SimulatedOutreachError,
} from "@/server/simulator/outreach";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const emptyBodySchema = z.object({}).strict();

async function parseEmptyBody(req: Request): Promise<boolean> {
  try {
    const text = await req.text();
    const raw = text.trim() ? JSON.parse(text) : {};
    return emptyBodySchema.safeParse(raw).success;
  } catch {
    return false;
  }
}

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  if (!(await parseEmptyBody(req))) {
    return apiError(400, "invalid_body", "El body del outreach debe estar vacío");
  }

  try {
    const message = await generateSimulatedFirstOutreach(
      session.organizationId,
      id
    );
    return Response.json(
      { message: serializeSimulatedMessage(message) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof SimulatedOutreachError) {
      if (error.code === "conversation_not_found") {
        return apiError(404, "not_found", "Conversación simulada no encontrada");
      }
      if (error.code === "generation_failed") {
        return apiError(502, "generation_failed", "No se pudo generar el outreach");
      }
      if (error.code === "profile_not_found") {
        return apiError(409, "profile_not_found", "El agente no está configurado");
      }
      return apiError(409, error.code, "La conversación no admite este outreach");
    }

    console.error(
      "[api/simulator/conversations/outreach] no se pudo generar el outreach"
    );
    return apiError(500, "internal", "No se pudo generar el outreach");
  }
});
