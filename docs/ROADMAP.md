# AI Setter — roadmap y backlog supervisado

Base: `feat/ai-setter-beta` / `5f4bf95`, inspección focalizada del 2026-10-26.
Marco documental entregado; ninguna tarea de implementación queda aprobada por
la mera creación de este archivo. Todo el backlog siguiente está PROPUESTO.
Las capacidades existentes constan en [AI_SETTER_SPEC](AI_SETTER_SPEC.md);
no se vuelven a construir sin un fallo reproducible.

## Hitos y aprobación

| Hito | Resultado revisable por el dueño | Tareas | Puerta humana |
|---|---|---|---|
| H0 | Marco y backlog acordados | Esta entrega documental | Aprobar orden, reglas y alcance de H1 |
| H1 | Beta simulada reproducible y base apta para Cloud | T01–T04 | Aceptar evidencia y autorizar H2 |
| H2 | Apertura y precualificación conversacional fiables | T05–T07 | Aprobar política de encaje/llamada y transcripciones; autorizar H3 |
| H3 | Propuesta y reserva simulada coherentes | T08–T09 | Aceptar recorrido de reserva; autorizar H4 |
| H4 | Seguimiento controlado y beta completa evaluada | T10–T11 | Aceptar beta; decidir próximo objetivo |

Aprobar un hito autoriza tareas técnicas dentro de sus límites sin consultas
entre pasos. No acepta el resultado por adelantado ni habilita producción.
H2 no comienza hasta aprobar su política comercial; H4 no comienza hasta aprobar
cadencia y límite de seguimiento. Dependencias entre hitos requieren aceptación
humana, además de tests verdes. Se permite aprobar solo un subconjunto por ID.

## Backlog en orden de dependencias

Todos los criterios remiten a IDs de [ACCEPTANCE_CRITERIA](ACCEPTANCE_CRITERIA.md).
Los comandos indicados son propuestas para futuras ejecuciones autorizadas.
Cada tarea requiere autorización inicial del hito; «extra» indica otra decisión
que no puede tomar Codex por su cuenta.

| ID / objetivo | Alcance acotado | Aceptación verificable | Tests previstos | Depende de | Aprobación humana extra |
|---|---|---|---|---|---|
| T01 — Baseline portable | Documentar comandos de arranque/prueba, runtime, flags y preflight sin secretos; preservar diff previo | A01: entorno limpio identificado, baseline y cambios previos separados; fallo de entorno registrado | Preflight Node 22/pnpm del manifest; gate técnico al disponer del entorno | H0 aceptado | Sí: preparar entorno e instalaciones; autorizar tratamiento del diff previo antes de incorporarlo |
| T02 — Fixtures sintéticas | Crear seed mínimo repetible para organización, operador, etapas, agentProfile y KB ficticios, respetando schema | A02: dos inicializaciones sin duplicados en BD desechable; ningún dato local privado | Unit de fixtures + integración con PostgreSQL aislado | T01 | Sí: aprobar corpus sintético; exportar Jynfits real requeriría aprobación independiente |
| T03 — E2E Setter mínimo | Añadir recorrido Playwright y controles API a arnés existente o runner focalizado: lead → apertura → inbound → respuesta → takeover | A03/A04/A05: UI y persistencia observables, aislamiento, sin envíos reales | Casos C01/C02/C06/C08; tenants y guardrails con spies/mocks | T02 | No, dentro de H1 |
| T04 — Entorno Cloud reproducible | Versionar setup/start y requisitos E2E; ampliar CI con PostgreSQL/mocks y reporte focalizado | A01/A03/A09: tarea nueva desde entorno publicado reproduce smoke y evidencia; build y E2E separados | Instalación frozen, gate existente, smoke nuevo y fallo del mock | T03 | Sí: conexión GitHub, permisos, recursos y publicación del entorno; PR/push solo si autorizados |
| T05 — Validar corrección de outreach | Revisar diff local y test existente; integrarlos solo con autorización; ajustar mínimo si falla | A04: apertura breve, contextual, sin llamada ni pregunta repetida; no duplicado por carrera | `pnpm exec vitest run tests/unit/first-outreach-prompt.test.ts tests/unit/simulated-outreach.test.ts tests/unit/simulated-outreach-flow.test.ts`; C01/C02/C08 y UI | H1 aceptado; T03/T04 | Sí: incorporar cambios previos y aprobar ejemplos de tono |
| T06 — Precualificar desde ficha | Ajustar prompt/flujo normal existente según política aprobada; sin nueva máquina de estados por defecto | A06: escucha, vacíos relevantes, sin cuestionario ni inferencias de encaje por inversión | Tests `ai-lead-context`, escenarios C02/C03/C04/C05; transcripciones multi-turno | T05 | Sí: aprobar reglas de interés/encaje y límites ante consultas sensibles |
| T07 — Resiliencia y control humano | Reusar retry/parseo existentes; corregir solo fallos reproducibles de salida inválida, takeover durante generación y SSE | A05/A07: IA en silencio tras takeover, error recuperable y sin duplicados | C06/C07/C08; unit adaptador/pipeline y E2E infeliz | T06 | No, dentro de H2; cambios de contrato/BD requieren nuevo plan aprobado |
| T08 — Proponer llamada con criterio | Aplicar política comercial aprobada en turnos normales; aprovechar acciones existentes | A08: solo interés+encaje evidenciados; rechazo no genera insistencia; primer outreach nunca propone | C03/C04/C05 y regresión C01, trazas de decisión | H2 aceptado; T07 | Sí: confirmar criterios y casos frontera antes de implementar |
| T09 — Reserva simulada | Conectar recorrido Setter con agenda existente detrás de bandera; elección, conflicto y confirmación; no conector real | A10: elección explícita, una reserva válida, conflicto ofrece recuperación, cero reunión externa | C09/C10; unit agenda-sandbox y Playwright Setter con agenda off/on | T08 | Sí: modalidad de reserva beta, zona horaria y cuándo derivar a humano; migración/contrato nuevo exige replanificar |
| T10 — Seguimiento simulado | Política mínima con reloj controlable, máximo de intentos y cancelaciones; reutilizar actividad existente si sirve | A11: solo tras plazo aprobado, no duplicados, se cancela ante respuesta/rechazo/handoff/reserva | C11/C12 con reloj simulado, reejecución y reinicio | H3 aceptado; T09 | Sí: cadencia, número de intentos y objetivo; persistencia nueva exige carril SDD completo |
| T11 — Evaluación y paquete beta | Ejecutar corpus completo, revisar regresiones y preparar PR y demo sintética del hito | A12: gates y E2E verdes, rúbrica y límites visibles, sin resultados inventados | C01–C12, regresión focalizada + gate completo | T10 | Sí: aceptación beta; proveedor real/modelo y presupuesto si se desea evaluación LLM |

## Registro durable y selección

Estados: PROPUESTA → APROBADA → EN_CURSO → VERIFICADA → ACEPTADA.
Alternativas: BLOQUEADA, CAMBIOS_SOLICITADOS. Una dependencia técnica se satisface
con VERIFICADA; la puerta de hito exige ACEPTADA por el dueño. Codex no se
asigna aprobaciones ni acepta hitos. Elegir el menor ID APROBADO con dependencias
satisfechas; no saltar a otro hito ni ampliar alcance para «aprovechar» una sesión.

Registrar aquí por tarea: estado, aprobación (quién/fecha/mensaje o enlace), base
Git, rama/PR, alcance, criterios, comandos y salidas resumidas, evidencia,
fallos/autocorrecciones, decisión y siguiente paso. Al iniciar implementación,
crear/usar spec de feature proporcional bajo `specs/` y enlazarla aquí;
`tasks.md` detalla ejecución, sin duplicar autorizaciones contradictorias.

| Fecha | ID | Estado / evidencia | Autorización |
|---|---|---|---|
| 2026-10-26 | H0 | Documentación redactada y revisada estáticamente; sin pruebas de aplicación | Usuario autoriza solo AGENTS.md y cuatro docs; no commit/push |
| 2026-10-26 | T01–T11 | PROPUESTAS; revisión focalizada del prompt: 23 tests verdes, sin E2E ni aceptación de T05 | Pendiente de aprobación por hito |
| 2026-10-26 | Sincronización | Revisión de siete archivos; dos commits independientes y push solicitados, resultado remoto en entrega Git | Usuario autoriza guardar docs y corrección de outreach; no ejecución de hitos ni PR |

## Decisiones pendientes agrupadas

Para H1: aprobar alcance, corpus sintético, preparación Cloud; definir permiso para futuras operaciones Git/PR y presupuesto
de recursos. La incorporación de la corrección actual y su push a
`origin/feat/ai-setter-beta` ya están autorizados para esta sincronización. Para H2: tono, encaje,
interés, desinterés y escalado. Para H3: reserva beta y zona horaria. Para H4:
cadencia y cancelaciones. No se necesitan resolver H3/H4 para empezar H1.
