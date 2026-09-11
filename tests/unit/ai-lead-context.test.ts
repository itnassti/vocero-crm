import { describe, expect, it } from "vitest";
import { renderKnownLeadContext } from "@/server/ai/prompts";

describe("contexto conocido del lead para el agente", () => {
  it("renderiza únicamente los campos comerciales permitidos", () => {
    const context = renderKnownLeadContext({
      name: " Laura Test ",
      source: "anuncio",
      stageName: "En conversación",
      ficha: {
        ageRange: "35-44",
        country: "España",
        goal: "Perder grasa",
        obstacles: "Constancia los fines de semana",
        willingToInvest: true,
        platform: "Instagram",
        email: "email-no-enviar@example.com",
        phone: "+34000000000",
        waIdentity: "sim:identidad-interna",
        campaignId: "campaign-interna",
        adsetId: "adset-interno",
        adId: "ad-interno",
        contactId: "ct_interno",
        leadId: "lead_interno",
      },
    });

    expect(context).toBe(
      [
        "CONTEXTO CONOCIDO DEL LEAD",
        "- Nombre: Laura Test",
        "- Rango de edad: 35-44",
        "- País: España",
        "- Objetivo: Perder grasa",
        "- Obstáculos: Constancia los fines de semana",
        "- Disposición a invertir: Sí",
        "- Origen: anuncio",
        "- Plataforma: Instagram",
        "- Etapa actual: En conversación",
        "",
        "Estos datos ya son conocidos. No vuelvas a preguntarlos salvo que exista una contradicción o sea necesario aclararlos.",
      ].join("\n")
    );
    expect(context).not.toContain("email-no-enviar");
    expect(context).not.toContain("+34000000000");
    expect(context).not.toContain("sim:identidad-interna");
    expect(context).not.toContain("campaign-interna");
    expect(context).not.toContain("adset-interno");
    expect(context).not.toContain("ad-interno");
    expect(context).not.toContain("ct_interno");
    expect(context).not.toContain("lead_interno");
  });

  it("expresa false como No y omite valores ausentes o vacíos", () => {
    expect(
      renderKnownLeadContext({
        name: "",
        source: null,
        stageName: null,
        ficha: {
          ageRange: null,
          country: undefined,
          goal: "  ",
          obstacles: null,
          willingToInvest: false,
          platform: undefined,
        },
      })
    ).toBe(
      [
        "CONTEXTO CONOCIDO DEL LEAD",
        "- Disposición a invertir: No",
        "",
        "Estos datos ya son conocidos. No vuelvas a preguntarlos salvo que exista una contradicción o sea necesario aclararlos.",
      ].join("\n")
    );
  });

  it("omite el bloque completo cuando no hay contexto conocido", () => {
    expect(renderKnownLeadContext({ ficha: {} })).toBeNull();
    expect(renderKnownLeadContext(null)).toBeNull();
  });
});
