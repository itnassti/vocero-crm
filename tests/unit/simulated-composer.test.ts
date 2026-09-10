// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationDto } from "@/lib/types";
import { Composer } from "@/components/inbox/composer";
import {
  DEFAULT_SIMULATION_MESSAGE_MODE,
  composerSendTarget,
  dispatchComposerText,
  requestSimulatedMessage,
  simulatedMessageEndpoint,
  submitSimulatedText,
  textAfterSimulatedSuccess,
  type SimulationMessageMode,
} from "@/components/inbox/composer-simulation";

Object.assign(globalThis, { React });

function conversation(id: string, simulated: boolean): ConversationDto {
  return {
    id,
    channel: "whatsapp",
    simulated,
    contact: { id: `ct_${id}`, name: "Lead", phone: null },
    stageName: "Nuevo",
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: null,
    lastMessageAt: null,
    unreadCount: 0,
    windowOpen: !simulated,
    windowRemainingMs: 1_000,
    preview: null,
  };
}

type ComposerCallbacks = {
  onSend: (text: string) => Promise<string | null>;
  onSendSimulated: (
    conversationId: string,
    mode: SimulationMessageMode,
    text: string
  ) => Promise<string | null>;
  onSent: () => void;
};

function callbacks(overrides: Partial<ComposerCallbacks> = {}): ComposerCallbacks {
  return {
    onSend: vi.fn(async () => null),
    onSendSimulated: vi.fn(async () => null),
    onSent: vi.fn(),
    ...overrides,
  };
}

function composerElement(current: ConversationDto, props: ComposerCallbacks) {
  return React.createElement(Composer, { conversation: current, ...props });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ templates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("composer de conversaciones simuladas", () => {
  it("mantiene el composer real sin selector y usa solo el callback real", async () => {
    const user = userEvent.setup();
    const props = callbacks();
    render(composerElement(conversation("cv_real", false), props));

    expect(screen.queryByText("Lead simulado")).toBeNull();
    expect(screen.getByLabelText("Adjuntar archivo")).toBeTruthy();

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textbox, "Mensaje real");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(props.onSend).toHaveBeenCalledOnce());
    expect(props.onSend).toHaveBeenCalledWith("Mensaje real");
    expect(props.onSendSimulated).not.toHaveBeenCalled();
    expect(textbox.value).toBe("");
  });

  it("muestra el selector solo en simuladas y usa Lead como default", () => {
    const props = callbacks();
    render(composerElement(conversation("cv_simulated", true), props));

    expect(DEFAULT_SIMULATION_MESSAGE_MODE).toBe("lead");
    expect(
      screen.getByRole("button", { name: "Lead simulado" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Operador" }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(screen.queryByLabelText("Adjuntar archivo")).toBeNull();
    expect(screen.queryByText("La ventana de 24 horas está cerrada.")).toBeNull();
  });

  it("envía Lead y Operador por el callback simulado sin alcanzar el real", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => null);
    const onSendSimulated = vi.fn(async () => null);
    const props = callbacks({ onSend, onSendSimulated });
    render(composerElement(conversation("cv_modes", true), props));
    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;

    await user.type(textbox, "Mensaje del lead");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(textbox.value).toBe(""));

    await user.click(screen.getByRole("button", { name: "Operador" }));
    await user.type(textbox, "Respuesta humana");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSendSimulated).toHaveBeenCalledTimes(2));
    expect(onSendSimulated).toHaveBeenNthCalledWith(
      1,
      "cv_modes",
      "lead",
      "Mensaje del lead"
    );
    expect(onSendSimulated).toHaveBeenNthCalledWith(
      2,
      "cv_modes",
      "operator",
      "Respuesta humana"
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it("resetea Lead en A → Operador → B → A", async () => {
    const user = userEvent.setup();
    const props = callbacks();
    const view = render(composerElement(conversation("cv_a", true), props));

    await user.click(screen.getByRole("button", { name: "Operador" }));
    expect(
      screen.getByRole("button", { name: "Operador" }).getAttribute("aria-pressed")
    ).toBe("true");

    view.rerender(composerElement(conversation("cv_b", true), props));
    expect(
      screen.getByRole("button", { name: "Lead simulado" }).getAttribute("aria-pressed")
    ).toBe("true");

    view.rerender(composerElement(conversation("cv_a", true), props));
    expect(
      screen.getByRole("button", { name: "Lead simulado" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("ignora el éxito tardío de A después de cambiar a B", async () => {
    const user = userEvent.setup();
    let resolveA!: (error: string | null) => void;
    const onSendSimulated = vi.fn(
      (conversationId: string) =>
        conversationId === "cv_a"
          ? new Promise<string | null>((resolve) => {
              resolveA = resolve;
            })
          : Promise.resolve(null)
    );
    const props = callbacks({ onSendSimulated });
    const view = render(composerElement(conversation("cv_a", true), props));

    await user.type(screen.getByRole("textbox"), "Texto de A");
    await user.click(screen.getByLabelText("Enviar"));
    expect(onSendSimulated).toHaveBeenCalledWith("cv_a", "lead", "Texto de A");

    view.rerender(composerElement(conversation("cv_b", true), props));
    const textboxB = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textboxB.disabled).toBe(false);
    expect(textboxB.value).toBe("");
    await user.type(textboxB, "B conserva este texto");

    await act(async () => resolveA(null));

    expect(textboxB.value).toBe("B conserva este texto");
    expect(textboxB.disabled).toBe(false);
    expect(screen.queryByText("Error de A")).toBeNull();
  });

  it("ignora el error tardío de A y permite enviar desde B", async () => {
    const user = userEvent.setup();
    let resolveA!: (error: string | null) => void;
    const onSendSimulated = vi.fn(
      (conversationId: string) =>
        conversationId === "cv_a"
          ? new Promise<string | null>((resolve) => {
              resolveA = resolve;
            })
          : Promise.resolve(null)
    );
    const props = callbacks({ onSendSimulated });
    const view = render(composerElement(conversation("cv_a", true), props));

    await user.type(screen.getByRole("textbox"), "Texto de A");
    await user.keyboard("{Enter}");
    view.rerender(composerElement(conversation("cv_b", true), props));

    const textboxB = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textboxB, "Texto de B");
    await act(async () => resolveA("Error de A"));

    expect(screen.queryByText("Error de A")).toBeNull();
    expect(textboxB.disabled).toBe(false);
    expect(textboxB.value).toBe("Texto de B");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSendSimulated).toHaveBeenCalledTimes(2));
    expect(onSendSimulated).toHaveBeenNthCalledWith(2, "cv_b", "lead", "Texto de B");
  });

  it("limpia el texto correcto tras éxito y lo conserva tras fallo", async () => {
    const user = userEvent.setup();
    const success = callbacks();
    const view = render(composerElement(conversation("cv_success", true), success));
    const successBox = screen.getByRole("textbox") as HTMLTextAreaElement;

    await user.type(successBox, "  Enviado  ");
    await user.click(screen.getByLabelText("Enviar"));
    await waitFor(() => expect(successBox.value).toBe(""));

    const failure = callbacks({
      onSendSimulated: vi.fn(async () => "No se pudo enviar"),
    });
    view.rerender(composerElement(conversation("cv_failure", true), failure));
    const failureBox = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(failureBox, "Reintentar");
    await user.click(screen.getByLabelText("Enviar"));

    await waitFor(() => expect(screen.getByText("No se pudo enviar")).toBeTruthy());
    expect(failureBox.value).toBe("Reintentar");
  });

  it("Enter envía y Shift+Enter conserva el salto sin enviar", async () => {
    const user = userEvent.setup();
    const onSendSimulated = vi.fn(async () => null);
    const props = callbacks({ onSendSimulated });
    render(composerElement(conversation("cv_keys", true), props));
    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;

    await user.type(textbox, "Primera línea");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSendSimulated).not.toHaveBeenCalled();
    expect(textbox.value).toBe("Primera línea\n");

    await user.type(textbox, "Segunda línea");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSendSimulated).toHaveBeenCalledOnce());
    expect(onSendSimulated).toHaveBeenCalledWith(
      "cv_keys",
      "lead",
      "Primera línea\nSegunda línea"
    );
  });

  it("separa de forma estricta los tres destinos de envío", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 201 })
    );

    expect(composerSendTarget(false, "lead")).toEqual({ kind: "real" });
    expect(composerSendTarget(true, "lead")).toEqual({ kind: "simulated", mode: "lead" });
    expect(composerSendTarget(true, "operator")).toEqual({
      kind: "simulated",
      mode: "operator",
    });
    expect(simulatedMessageEndpoint("cv_1", "lead")).toBe(
      "/api/simulator/conversations/cv_1/messages"
    );
    expect(simulatedMessageEndpoint("cv_1", "operator")).toBe(
      "/api/simulator/conversations/cv_1/operator-messages"
    );

    await requestSimulatedMessage({
      conversationId: "cv_1",
      mode: "lead",
      text: "Hola",
      fetcher,
    });
    await requestSimulatedMessage({
      conversationId: "cv_1",
      mode: "operator",
      text: "Respuesta",
      fetcher,
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/simulator/conversations/cv_1/messages",
      "/api/simulator/conversations/cv_1/operator-messages",
    ]);

    const sendReal = vi.fn(async () => null);
    const sendSimulated = vi.fn(async () => null);
    await dispatchComposerText({
      simulated: false,
      mode: "lead",
      conversationId: "cv_real",
      text: "Real",
      sendReal,
      sendSimulated,
    });
    await dispatchComposerText({
      simulated: true,
      mode: "lead",
      conversationId: "cv_simulated",
      text: "Lead",
      sendReal,
      sendSimulated,
    });
    await dispatchComposerText({
      simulated: true,
      mode: "operator",
      conversationId: "cv_simulated",
      text: "Operador",
      sendReal,
      sendSimulated,
    });

    expect(sendReal).toHaveBeenCalledOnce();
    expect(sendSimulated).toHaveBeenCalledTimes(2);
  });

  it("bloquea un segundo envío mientras la request está pendiente", async () => {
    let finish!: (error: string | null) => void;
    const send = vi.fn(
      () => new Promise<string | null>((resolve) => (finish = resolve))
    );
    const inFlight = { current: false };

    const first = submitSimulatedText({ text: "Hola", inFlight, send });
    const second = await submitSimulatedText({ text: "Hola", inFlight, send });

    expect(second).toEqual({ status: "ignored" });
    expect(send).toHaveBeenCalledOnce();
    finish(null);
    await expect(first).resolves.toEqual({ status: "success", text: "Hola" });
  });

  it("conserva el texto de helper en error y lo limpia únicamente tras éxito", async () => {
    const inFlight = { current: false };
    const failed = await submitSimulatedText({
      text: "  Reintentar  ",
      inFlight,
      send: async () => "No se pudo enviar",
    });
    const succeeded = await submitSimulatedText({
      text: "  Enviado  ",
      inFlight,
      send: async () => null,
    });

    expect(failed).toEqual({
      status: "error",
      text: "Reintentar",
      error: "No se pudo enviar",
    });
    expect(textAfterSimulatedSuccess("  Reintentar  ", "otro texto")).toBe(
      "  Reintentar  "
    );
    expect(succeeded).toEqual({ status: "success", text: "Enviado" });
    expect(textAfterSimulatedSuccess("  Enviado  ", "Enviado")).toBe("");
  });
});
