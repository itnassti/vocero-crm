export type SimulationMessageMode = "lead" | "operator";

export const DEFAULT_SIMULATION_MESSAGE_MODE: SimulationMessageMode = "lead";

export function composerSendTarget(
  simulated: boolean,
  mode: SimulationMessageMode
): { kind: "real" } | { kind: "simulated"; mode: SimulationMessageMode } {
  return simulated ? { kind: "simulated", mode } : { kind: "real" };
}

export function dispatchComposerText(input: {
  simulated: boolean;
  mode: SimulationMessageMode;
  conversationId: string;
  text: string;
  sendReal: (text: string) => Promise<string | null>;
  sendSimulated: (
    conversationId: string,
    mode: SimulationMessageMode,
    text: string
  ) => Promise<string | null>;
}): Promise<string | null> {
  const target = composerSendTarget(input.simulated, input.mode);
  return target.kind === "simulated"
    ? input.sendSimulated(input.conversationId, target.mode, input.text)
    : input.sendReal(input.text);
}

export function simulatedMessageEndpoint(
  conversationId: string,
  mode: SimulationMessageMode
): string {
  const action = mode === "lead" ? "messages" : "operator-messages";
  return `/api/simulator/conversations/${encodeURIComponent(conversationId)}/${action}`;
}

export async function requestSimulatedMessage(input: {
  conversationId: string;
  mode: SimulationMessageMode;
  text: string;
  fetcher?: typeof fetch;
}): Promise<string | null> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    simulatedMessageEndpoint(input.conversationId, input.mode),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: input.text }),
    }
  ).catch(() => null);

  if (!response) return "Sin conexión con el servidor";
  if (response.ok) return null;

  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? "No se pudo enviar el mensaje simulado";
}

export async function submitSimulatedText(input: {
  text: string;
  inFlight: { current: boolean };
  send: (text: string) => Promise<string | null>;
}): Promise<
  | { status: "ignored" }
  | { status: "success"; text: string }
  | { status: "error"; text: string; error: string }
> {
  const text = input.text.trim();
  if (!text || input.inFlight.current) return { status: "ignored" };

  input.inFlight.current = true;
  try {
    const error = await input.send(text);
    return error
      ? { status: "error", text, error }
      : { status: "success", text };
  } finally {
    input.inFlight.current = false;
  }
}

export function textAfterSimulatedSuccess(
  currentText: string,
  sentText: string
): string {
  return currentText.trim() === sentText ? "" : currentText;
}
