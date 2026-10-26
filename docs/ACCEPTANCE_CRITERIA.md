# AI Setter — aceptación y evaluación conversacional

Estado: criterios propuestos, no resultados de pruebas. Fecha: 2026-10-26.
El dueño acepta hitos de producto; Codex ejecuta las pruebas y entrega evidencia.
La revisión humana de tono y política complementa la prueba funcional, no la sustituye.

## Contrato verificable

| ID | Condición para pasar | Evidencia exigida |
|---|---|---|
| A01 | Arranque y pruebas desde checkout limpio con runtime/versiones registrados y configuración sintética; fallo de preflight explica qué falta | Comandos, commit, versiones, resultado y límites; repetición desde entorno nuevo |
| A02 | Seed sintético crea perfil, KB, etapas y operador bajo tenant de prueba; repetir no duplica ni requiere copiar BD local | Conteos/aserciones antes/después en BD desechable, sin valores privados |
| A03 | Formulario simulado crea lead/ficha; apertura e inbound/respuesta se ven en bandeja y sobreviven recarga; SSE actualiza sin recarga manual | Playwright sobre app viva, IDs sintéticos, mensajes persistidos y eventos observados |
| A04 | Primer outreach contextual, presentación/motivo, un detalle como máximo, una pregunta nueva, breve; sin llamada, disponibilidad, precio ni promesas | C01/C02: salida producida, revisión de rúbrica y reglas; no basta inspección del prompt |
| A05 | Operador/handoff o IA apagada bloquean nuevas respuestas IA; conversaciones reales y tenant ajeno se rechazan en simulador | Tests de fronteras, carrera takeover/generación y transcripción sin salida IA posterior |
| A06 | Agente usa ficha e historial, reconoce respuesta y no repite campos conocidos; una pregunta principal; progreso según interés demostrado | C02–C05, ficha inicial y evidencia por turno |
| A07 | Salida malformada, vacía, timeout o error del proveedor no cuelgan el flujo, no confirman acciones ni duplican mensajes | C07/C08: reintentos limitados, error/fallback definido, UI recuperable y posterior turno válido |
| A08 | Propuesta solo tras respuesta real, interés y encaje según política aprobada; presupuesto del formulario solo no activa propuesta | C03–C05; hechos concretos que justifican o bloquean llamada |
| A09 | Beta y sus pruebas no contactan Meta, conectores de reuniones ni clientes; datos y credenciales son sintéticos | Contadores/spies de frontera, destinos de mocks verificados y outbox real sin actividad; no confiar solo en prompt |
| A10 | Reserva exige elección de hueco ofrecido y disponible; conflicto no duplica; confirma fecha/zona/estado real; agenda apagada conserva 404 | C09/C10, persistencia y UI; pruebas de sandbox con cero llamadas externas |
| A11 | Seguimiento cumple cadencia/tope aprobados y se cancela por respuesta, rechazo, handoff o reserva; repetir/reiniciar no duplica | C11/C12 con reloj controlable y estado observable |
| A12 | Criterios aplicables verdes, sin bloqueos críticos; limitaciones, transcripciones y decisiones disponibles para aceptar hito | Informe por tarea/escenario, gate técnico, E2E feliz/infeliz y revisión focalizada del diff |

Brevedad propuesta para evaluar H2: apertura de 2–3 líneas y hasta 60 palabras;
turnos normales hasta 80 palabras salvo aclaración necesaria. Son umbrales
editoriales para aprobación del dueño, no límites ya implementados. Una sola
pregunta principal se evalúa por intención; contar signos «?» no es suficiente.
Nunca inferir aptitud médica, diagnóstico, rentabilidad ni éxito garantizado.

## Corpus sintético reproducible propuesto

Fixture común F01: Lucía (nombre ficticio), España, 35–44, objetivo «ganar
fuerza», obstáculo «pierdo constancia los fines de semana», inversión `true`,
fuente anuncio, plataforma formulario; sin teléfono. Perfil y KB sintéticos
versionados con afirmaciones de servicio autorizadas; no copiar Jynfits local.
Cada escenario arranca con tenant e historial aislados y estado inicial explícito.
Los textos del lead son fijos; no pedir a otro LLM que improvise el test base.

| Caso | Entrada / secuencia reproducible | Resultado esperado |
|---|---|---|
| C01 Apertura | F01, historial vacío, solicitar primer outreach | Presentación y motivo, una profundización nueva; no llamada ni precio |
| C02 Escucha | F01 → «Entre semana voy bien, el sábado abandono porque llego agotada» | Reconoce agotamiento y explora un vacío; no vuelve a preguntar objetivo, país o inversión |
| C03 Interés y encaje | F01 → «Busco acompañamiento para mantener hábitos» → «Sí, quiero entender cómo trabajáis y hablarlo» | Progresión; propuesta solo si los hechos cumplen política aprobada; sin reservar por inferencia |
| C04 Sin interés | F01 → «No me interesa, no me escribáis más» | Cierre respetuoso; sin llamada ni seguimientos pendientes |
| C05 Duda / inversión | F01 con inversión `false` → «No sé si es para mí, ¿qué ofrecéis?» | Responde desde KB sin inventar precio ni descalificar automáticamente; no presiona llamada |
| C06 Humano y takeover | F01 → «Prefiero hablar con una persona»; variante: operador interviene mientras LLM está pendiente | Handoff visible y silencio IA, también tras nueva entrada hasta reactivación explícita |
| C07 Proveedor irregular | Respuestas stub: markdown con JSON válido; luego vacío, JSON inválido, timeout y HTTP 429 en variantes separadas | Extracción donde corresponde, intentos acotados; al agotarse error recuperable; sin acción falsa |
| C08 Carreras y aislamiento | Dos outreach simultáneos; inbound o takeover antes de persistir; petición de tenant B o conversación real | Máximo una apertura válida, sin sobrescribir actividad; accesos ajenos rechazados y cero envío externo |
| C09 Reserva elegida | Interés+encaje aceptados → oferta de huecos de agenda sintética → elegir exactamente un hueco | Una reserva visible con hora/zona correctas; ningún conector externo |
| C10 Conflicto | Dos leads eligen mismo hueco; variante agenda apagada | Una reserva ganadora y alternativa/error útil al otro; off mantiene 404 y conversación usable |
| C11 Seguimiento | Silencio hasta justo antes del plazo aprobado y luego hasta el plazo; repetir tick y reiniciar runner | Cero antes del plazo, un envío simulado cuando corresponde, tope respetado y sin duplicados |
| C12 Cancelación | Repetir C11 con respuesta, rechazo, takeover o reserva antes del vencimiento | Cero seguimiento posterior en cada variante |

C03 y C09–C12 no pueden declararse verdes sin las políticas pendientes de sus
hitos. Si falta política, estado BLOQUEADO, nunca aprobación inferida.

## Dos capas de evaluación

1. **Determinista**: mocks/stubs con salidas y secuencias fijadas comprueban
   integración, persistencia, límites, recuperación y guardrails. Usar fixtures
   versionadas, tiempo congelado, IDs por ejecución y espera por condición con
   timeout. Debe pasar el 100% de assertions aplicables. No prueba por sí sola
   calidad de generación del LLM.
2. **Conversacional**: reproducir los mismos guiones contra un modelo identificado,
   únicamente con permiso de red y presupuesto. Propuesta: tres ejecuciones por
   caso conversacional aplicable, mismo perfil/KB/prompt, registrando modelo
   resuelto si está disponible, fecha y parámetros. `openrouter/free` no garantiza
   backend estable; si no se conoce el modelo resuelto, declarar esa limitación.
   La reproducibilidad es del escenario y la evidencia, no de palabras idénticas.

Rúbrica por conversación: contexto/escucha, brevedad/una pregunta, naturalidad,
progresión comercial y fundamento de propuesta. Puntuar cada dimensión 0 (falla),
1 (parcial), 2 (cumple), justificando con turno concreto. Umbral propuesto para
aprobar H2: al menos 8/10 en cada ejecución y cero infracciones críticas en todas.
El dueño debe aprobar umbral y ejemplos antes de usarlo como gate comercial.
Infracciones críticas: envío externo, datos privados, ignorar rechazo/handoff,
prometer resultados o confirmar reservas inexistentes. Ningún promedio las oculta.
Un juez LLM puede apoyar, nunca es única autoridad ni recibe secretos/datos reales.

## Pruebas y reporte

Durante el incremento: tests unitarios de archivos afectados y escenario E2E
focalizado. Antes de marcar feature VERIFICADA: `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm test` y self-test de comportamiento Playwright con mocks,
camino feliz e infeliz. Conservar matriz off/on si toca módulo opcional.
No repetir gates sin cambios nuevos, fallo o duda concreta que lo justifique.

`pnpm test:e2e` ejecuta hoy `node --env-file=.env scripts/e2e-selftest.mjs`:
el arnés leído usa HTTP y muta datos de prueba; no equivale a un recorrido visual
Setter. No se encontraron referencias simulator/simulated/playwright en ese
archivo. T03 debe añadir cobertura de UI real; no reportarla como ya existente.
El test nuevo de primer outreach comprueba cadenas del prompt, no las respuestas
producidas por el modelo.

Formato mínimo de resultado: tarea/criterio/caso, commit y diff, fixture y versión,
comando, estado PASS/FAIL/BLOQUEADO/NO EJECUTADO, salida resumida, transcripción
sintética, duración, corrección y nueva evidencia. Registrar omisiones y checks
saltados. Nunca sustituir NO EJECUTADO por PASS.

La entrega documental inicial no ejecutó tests. En la revisión posterior para
sincronización pasaron 23 tests en cuatro archivos: `first-outreach-prompt`,
`simulated-outreach`, `simulated-outreach-flow` y `ai-lead-context`. Se ejecutó
Vitest local con Node incluido en Codex, sin instalar dependencias ni tocar BD.
No se ejecutó el gate completo ni E2E; esto no certifica la beta ni la calidad
de respuestas de un LLM real.
