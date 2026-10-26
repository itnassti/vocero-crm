import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

const profile = {
  name: "Nuria",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
} as never;

const baseInput = {
  profile,
  kb: [],
  stages: [{ name: "Nuevo" }],
  leadContext: {
    name: "Lucía",
    source: "anuncio",
    stageName: "Nuevo",
    ficha: {
      goal: "perder grasa y sentirme más fuerte",
      obstacles: "pierdo la constancia los fines de semana",
      country: "España",
      ageRange: "35-44",
      willingToInvest: true,
      platform: "Instagram",
    },
  },
  agenda: false,
};

describe("prompt del primer outreach", () => {
  it("define un primer contacto exploratorio y reply-only", () => {
    const prompt = buildAgentSystemPrompt({
      ...baseInput,
      turnMode: "first_outreach",
    });

    expect(prompt).toContain("MODO DEL TURNO: PRIMER OUTREACH");
    expect(prompt).toContain("NO propongas una videollamada");
    expect(prompt).toContain("NO preguntes disponibilidad");
    expect(prompt).toContain("NO menciones Calendly");
    expect(prompt).toContain("NO preguntes si tiene 15 minutos");
    expect(prompt).toContain("NO menciones precio");
    expect(prompt).toContain("Haz UNA sola pregunta");
    expect(prompt).toContain("información nueva");
    expect(prompt).toContain("No preguntes nada cuya respuesta ya aparezca");
    expect(prompt).toContain("como máximo UN detalle relevante");
    expect(prompt).toContain("úsalo de forma natural en la apertura");
    expect(prompt).toContain("tiene arreglo");
    expect(prompt).toContain("al menos una respuesta real del lead");
    expect(prompt).toContain('{"action":"reply","text":"..."}');
  });

  it("no añade las reglas de primer outreach al turno normal", () => {
    const prompt = buildAgentSystemPrompt({
      ...baseInput,
      turnMode: "normal",
    });

    expect(prompt).not.toContain("MODO DEL TURNO: PRIMER OUTREACH");
    expect(prompt).not.toContain("NO propongas una videollamada");
    expect(prompt).not.toContain("Haz UNA sola pregunta");
    expect(prompt).toContain('- {"action":"handoff","reason":"...","farewell":"..."}');
    expect(prompt).toContain('- {"action":"update_lead","note":"...","reply":"..."}');
  });
});
