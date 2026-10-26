# AI Setter — especificación de la beta

Fecha base: 2026-10-26. Estado: propuesta para aprobación de hitos.
Esta especificación documenta retrospectivamente lo implementado hasta
`5f4bf95` y define por adelantado el comportamiento pendiente. No certifica
que la beta esté verificada. Rama inspeccionada: `feat/ai-setter-beta`.

## Resultado esperado

Ayudar a un coach online a conversar con leads que rellenaron un formulario:
formulario → ficha estructurada → primer outreach IA → precualificación →
interés y encaje → propuesta de videollamada → reserva → seguimiento o handoff.
La beta ejerce ese recorrido con identidades y conversaciones sintéticas.
Nuria/Jynfits es referencia inicial de estilo y conocimiento, no una orden de
copiar su funnel de Instagram/ZeroChats ni de incorporar ese transporte.

El formulario ya recoge objetivo, obstáculos, país, rango de edad y disposición
a invertir. El agente parte de ese contexto, escucha lo nuevo y profundiza sin
repetir la cualificación desde cero. Una pregunta principal por mensaje, mensajes
breves, progresión comercial sin presión ni promesas inventadas.

## Estado observado y límites de la evidencia

Inspección focalizada de fuentes y tests; no ejecución funcional ni lectura de BD.
Codebase Memory no expuso herramientas en esta sesión: proyecto, generación y
cobertura del índice no verificados; se usó lectura directa. No se reindexó.

| Capacidad | Evidencia del repositorio | Estado |
|---|---|---|
| Lead simulado y ficha | `src/server/simulator/leads.ts`, rutas `/api/simulator/leads`, tests `simulated-lead*` | Implementado; crea `sim:<id>`, conversación `isTest`, ficha y etapa abierta |
| Inbound simulado | `src/server/simulator/messages.ts`, tests `simulated-message*` | Implementado; actividad, SSE y trigger IA |
| Bandeja y ficha | Contexto del dueño y componentes existentes; test `simulated-composer.test.ts` | Existentes; validación visual pendiente |
| Salida IA local | `src/server/simulator/ai-outbound.ts`, `src/server/ai/pipeline.ts`, test `simulated-ai-outbound.test.ts` | Implementada; falta revalidación viva |
| Operador y handoff | `src/server/simulator/operator-messages.ts`, tests `simulated-operator-message*` | Implementados; tests describen takeover y conservación de handoff |
| Ficha en LLM | `src/server/ai/context.ts`, `src/server/ai/prompts.ts`, test `ai-lead-context.test.ts` | Fuente compartida: perfil, KB, etapa y ficha |
| Primer outreach | `src/server/simulator/outreach.ts`, tests `simulated-outreach*` | Implementado en `5f4bf95`; modo reply-only y `agenda: false` |
| Corrección de apertura | Diff local `prompts.ts` + test nuevo `first-outreach-prompt.test.ts` | Corrección autorizada para commit/sincronización; 23 tests focalizados verdes, sin E2E |
| Agenda genérica | `src/server/agenda/`, spec `015-motor-agenda-universal` | Existente en Vocero; no prueba de recorrido Setter integrado |
| Seguimiento Setter | No se verificó una implementación específica en el alcance leído | Pendiente de definición; no afirmar ausencia global |

La apertura comprueba conversación de prueba, IA activa, sin handoff e historial
vacío; usa lock en proceso y revalida al persistir con bloqueo de fila. Existen
tests de carreras entre outreach e inbound. No extrapolar esto a garantía de
idempotencia distribuida sin probarla. El adaptador `src/lib/ai/index.ts` ya
incluye extracción JSON, Zod, tres intentos y timeout: extender sus pruebas,
no reconstruirlo por defecto.

Perfil y KB Jynfits en PostgreSQL local y modelo `openrouter/free`: información
aportada por el dueño, no confirmada leyendo datos ni `.env`. No se exportaron.
La terminal normal no resolvía `node`. En la sesión de sincronización se localizó
el runtime incluido en Codex (Node `v24.19.0`) y se ejecutó Vitest directamente,
sin instalaciones: cuatro archivos y 23 tests pasaron (prompt, contexto del lead,
outreach y carreras del flujo). No se verificó pnpm ni la portabilidad Cloud.
El entorno Cloud sigue pendiente.

## Comportamiento a aceptar

1. Crear un lead sintético con ficha y conversación visibles, sin necesitar teléfono.
2. Abrir con presentación y motivo naturales, máximo un detalle de formulario y
   una pregunta nueva. La corrección de apertura propone 2–3 líneas, sin llamada,
   disponibilidad, precio ni promesas en esa apertura.
3. Tras respuestas del lead, reconocer lo dicho y profundizar solo en vacíos
   relevantes. El historial y la ficha deben influir en la siguiente respuesta.
4. Proponer llamada cuando haya interés expresado y encaje respaldado por hechos;
   disponer de presupuesto en el formulario no equivale a aceptar una llamada.
   Al menos una respuesta del lead es condición necesaria, no suficiente.
5. Rechazo, petición de parar o de humano: respetarlos. Handoff suspende IA;
   intervención del operador conserva el control hasta reactivación explícita.
6. Reservar únicamente huecos realmente disponibles tras elección explícita;
   una propuesta o enlace nunca se registra como reserva confirmada.
7. Seguimiento requiere política aprobada, límite y cancelación por respuesta,
   rechazo o handoff. En beta solo simulación y reloj controlable.
8. Fallos del proveedor no producen confirmaciones falsas ni duplicados; dejan
   resultado visible y recuperable dentro del sandbox.

Los puntos 4, 6 y 7 necesitan concretar política de negocio antes de implementarse
(ver hitos H2–H4 en [ROADMAP](ROADMAP.md)); no son funcionalidad certificada.

## Fuera de alcance de la beta aprobable inicial

WhatsApp real, funnel Instagram/ZeroChats, billing, onboarding SaaS avanzado,
rediseño de tenancy, conectores externos nuevos y producción. Conservar Next,
Drizzle, PostgreSQL, Better Auth, SSE, adaptador LLM y guardrails actuales.
La arquitectura de una instancia por negocio se mantiene; el destino SaaS no
justifica una migración prematura.

## Documentos y decisiones

[Roadmap](ROADMAP.md) gobierna orden y autorización;
[criterios](ACCEPTANCE_CRITERIA.md) gobiernan evidencia;
[operación](AUTONOMOUS_DEVELOPMENT.md) gobierna el ciclo y Cloud.
Cambiar decisiones de producto requiere aprobación y actualizar esos enlaces,
no inferir políticas desde las salidas de un modelo.
