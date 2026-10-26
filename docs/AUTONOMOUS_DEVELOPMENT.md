# AI Setter — desarrollo semiautónomo por hitos

Estado: diseño operativo propuesto, 2026-10-26. No instala un runner, no programa
automatizaciones y no inicia tareas del backlog. El primer paso del dueño es
aprobar H1 o un subconjunto de IDs de [ROADMAP](ROADMAP.md).

## Autoridad y límites

El dueño define el resultado y acepta hitos. Codex decide implementación y
correcciones técnicas dentro del hito aprobado, verifica y prepara evidencia.
La aprobación debe registrar hito/IDs, alcance, base, operaciones Git permitidas,
entorno de prueba, límites de tiempo/recursos/red y decisiones comerciales.
No se pide aprobación por cada fix reversible ya incluido en ese alcance.

Sin aprobación expresa adicional: no datos reales, WhatsApp real, producción,
secretos, merge a main ni ampliación de alcance. No resolver carencias de Cloud
con acceso a la BD local o credenciales de negocio. La regla genérica de
placeholders de AGENTS no habilita modificar `.env` en este proyecto AI Setter.

La sesión documental inicial del 2026-10-26 autorizó únicamente `AGENTS.md` y
los cuatro documentos AI Setter. La instrucción posterior autoriza revisar y
guardar esos documentos junto al prompt y su test en dos commits, y sincronizar
solo `feat/ai-setter-beta` con origin, sin force push. No autoriza ejecutar H1,
instalaciones, cambios de BD o `.env`, producción ni merge a main. Ante necesidad
de autenticación o permisos para el push, detenerse y pedir autorización.

## Ciclo ejecutable por el agente

1. **Reanudar**: leer aprobación vigente y registro de ROADMAP; comprobar rama,
   base y cambios sin commit. Leer solo spec/tarea y fuentes relevantes. Consultar
   grafo y cobertura si hay MCP; si falta, registrar y usar fuente concreta.
   Reindexar solo ante necesidad demostrada, no al iniciar cada tarea. No repetir
   auditoría de arquitectura ni escanear datos/secretos.
2. **Seleccionar**: menor ID APROBADO con dependencias verificadas y puerta de
   hito anterior aceptada. Si no existe, entregar paquete de aprobación; no
   inventar tareas para continuar. Una tarea activa evita conflictos de estado.
3. **Acotar**: registrar EN_CURSO, criterios, archivos previstos y test focalizado.
   Elegir carril SDD según constitución: exento para fix trivial; spec ligera
   para nuevo comportamiento interno; spec/plan/tasks para BD o contrato.
   Cambio de carril o requisito fuera del hito obliga a replanificar y pedir
   decisión, no a rediseñar preventivamente el producto.
4. **Implementar**: cambio mínimo, reutilizar adaptadores, UI, scoped, SSE y
   controles de sandbox existentes. Preservar modificaciones previas. No activar
   canales/conectores externos para lograr que una prueba pase.
5. **Probar y autocorregir**: ejecutar tests de impacto y E2E focalizado. Frente a
   un fallo: guardar evidencia, formular causa, corregir, repetir checks afectados.
   Propuesta de límite operativo a aprobar con H1: tres ciclos sin progreso o
   60 minutos por tarea; entonces registrar bloqueo y diagnóstico. No cambiar
   umbrales ni borrar assertions para obtener verde. No reiterar fallo de entorno
   como si fuera fallo de producto.
6. **Revisar**: inspeccionar diff de la tarea, contratos, aislamiento tenant,
   carreras/idempotencia, exposición de secretos y envíos externos. Comparar cada
   criterio con evidencia observable y revisar transcripciones si toca diálogo.
   Es revisión focalizada del cambio, no auditoría del repositorio entero.
7. **Cerrar incremento**: cumplir gate técnico y comportamiento antes de declarar
   feature VERIFICADA; registrar comando, resultado y limitaciones. Si la sesión
   se interrumpe, dejar EN_CURSO/BLOQUEADA con siguiente paso concreto. Una prueba
   no ejecutable nunca se declara pasada.
8. **Continuar o entregar**: seleccionar siguiente tarea segura del mismo hito
   aprobado. Al terminar hito, preparar diff/PR autorizado, demo sintética,
   criterios y riesgos para aceptación del dueño. No iniciar siguiente hito ni
   hacer merge automáticamente. La aceptación actualiza el registro con fuente.

No hay garantía de ejecución infinita o reanudación programada: el backlog y los
registros permiten retomar en otra sesión. Un monitor/automatización requeriría
una petición separada. La revisión la puede hacer la propia sesión; este marco
no exige agentes paralelos ni crea chats automáticamente.

## Paquete de revisión por hito

Entregar resultado de producto, tareas y criterios cumplidos, ejemplos observables,
comandos con PASS/FAIL/NO EJECUTADO, fallos corregidos, cambios pendientes y riesgos.
Una PR pequeña por tarea o grupo coherente del mismo hito; enlazar las PR en el
registro. El dueño revisa el efecto del hito y sus decisiones comerciales, con
checks técnicos disponibles, sin necesitar aprobar cada edición técnica.
Revisiones automáticas pueden detectar problemas pero no aceptan el hito.

Plantilla de autorización futura (rellenar, no ejecutar literalmente):

> Apruebo H1 (T01–T04) sobre la base acordada. Autorizo [operaciones Git],
> [preparación del entorno y BD desechable], [recursos y límite]. Solo datos
> sintéticos y mocks; sin secretos reales, WhatsApp, producción ni merge.
> El diff local de outreach se [preserva fuera / incorpora expresamente].

## Propuesta de Codex Cloud y aislamiento

La documentación oficial describe entornos reutilizables publicados y un espacio
independiente por tarea Cloud. El acceso, red y servicios deben comprobarse en
la cuenta; este repositorio aún no tiene un entorno Cloud validado.
[Entornos Cloud](https://learn.chatgpt.com/docs/environments/cloud-environments).

Flujo propuesto para este repo:

1. Con autorización, asegurar que la base funcional y los documentos estén en
   una rama remota revisada. Los cambios locales sin commit no viajan por sí
   solos; no partir de main por defecto ni asumir que `5f4bf95` está remoto.
2. En local, usar worktree separado por tarea para conservar el checkout actual;
   en Cloud usar su workspace aislado y una rama `codex/ai-setter-tNN-descripcion`
   desde la base acordada de `feat/ai-setter-beta`. Verificar SHA al empezar.
   Worktrees locales y workspace Cloud son mecanismos distintos.
3. Preparar entorno con Node 22 (alineado con CI/Docker), pnpm indicado en
   `packageManager` (`11.5.0` en esta inspección), lockfile frozen, PostgreSQL
   desechable y navegador/dependencias Playwright. Validar compatibilidad real
   de runtime/pnpm antes de fijar setup; no actualizar dependencias a ciegas.
4. Instalar y probar servicios en el setup autorizado. En cada tarea: preflight,
   BD/nombre aislados, migraciones versionadas, seed sintético, mocks y app de
   prueba; readiness de app y BD, limpieza solo de sus recursos. No asumir que
   procesos o puertos sobreviven entre sesiones.
5. E2E con `WA_MOCK_ENABLED=true`, bases Meta/LLM hacia mocks locales y valores
   sintéticos suficientes para los validadores. Mantener módulos opcionales
   apagados salvo caso de prueba. Bloquear destinos reales como segunda barrera.
6. Ejecutar build como gate separado. Los mocks dev son 404 en producción: usar
   app en modo de prueba/desarrollo para E2E, no la imagen production esperando
   que exponga mocks. Verificar las bases de URL antes de iniciar el arnés.
7. Publicar y probar el entorno con una tarea nueva antes de dar T04 por cumplida.
   PR hacia la rama de integración acordada, con tests y evidencia. Checks
   requeridos y revisión humana; sin auto-merge ni despliegues por PR. Revisar
   automatismos remotos antes del primer push; esta sesión no los verificó.

La documentación oficial diferencia Worktree local y Cloud y aclara que archivos,
procesos y accesos locales no se transfieren automáticamente.
[Modos de entorno](https://learn.chatgpt.com/docs/environments/modes).
Este documento propone la política de ramas y PR; no afirma que Cloud la imponga.

## Qué portar antes de desarrollar y probar en Cloud

| Dependencia local / gap | Acción propuesta | Verificación / responsable |
|---|---|---|
| Commit funcional y diff de outreach no consolidado | Acordar qué se incorpora y llevarlo mediante Git/PR autorizado | Dueño aprueba; agente comprueba SHA y diff, nunca sobrescribe el local |
| agentProfile y KB Jynfits en PostgreSQL | Preferir perfil/KB sintéticos versionados; solo exportar selección real con consentimiento y anonimización revisada | Dueño aprueba contenido; seed no depende de volcado privado |
| Organización, operador, etapas y ficha inicial | Fixture repetible con IDs aislados y credenciales de prueba | Dos inicializaciones y smoke desde BD vacía |
| BD y migraciones | PostgreSQL desechable por tarea, esquema migrado y reset acotado | Sin acceso a BD local/producción; probar conectividad y migración |
| Node/pnpm de máquina local | Setup portable, versiones derivadas del repo y preflight | `node --version`, `pnpm --version`, instalación frozen y comandos reales |
| Configuración `.env` local | Documentar nombres usando `.env.example`; no copiar archivo ni valores | Dueño gestiona variables sintéticas; ninguna modificación de secretos por Codex |
| LLM `openrouter/free` | Mock determinista por defecto; evaluación real opcional con modelo/corpus/presupuesto aprobados | Identidad y variabilidad declaradas; no gate semántico basado solo en mocks |
| Navegador, auth y sesiones locales | Playwright y login sintético reproducibles | No depender de cookies, navegador del dueño ni VPN |
| E2E actual y CI | T03 añade flujo Setter visual; T04 PostgreSQL/mocks y reporte CI | CI actual tiene typecheck/lint/test/build en matriz default/completo; sin E2E en workflow leído |
| Script E2E carga `.env` | Definir archivo efímero sintético o runner que acepte entorno inyectado, dentro de tarea autorizada | No copiar `.env` privado; comprobar precedence y destinos efectivos |
| Skills/MCP locales | Verificar qué existe en Cloud, versionar solo instrucciones portables sin credenciales | Sin graph MCP usar fuente focalizada; sin reindexado automático |
| Red y GitHub | Autorizar repo/base, dominios necesarios y permisos mínimos de PR | Dueño configura acceso; publicación Cloud e instalaciones no hechas aquí |

No portar adjuntos, transcripciones de clientes, sesiones, llaves de cifrado,
tokens ni volcado completo de PostgreSQL. Sin acceso a Jynfits real se puede
validar integración con fixtures; no se puede certificar fidelidad a esa KB.

## Riesgos, límites y decisiones registradas

- La inspección fue focalizada y estática. Existencia de código/tests no acredita
  resultados; reserva/seguimiento Setter requieren validación específica.
- Los docs históricos `docs/sdd-workflow.md` y `docs/three-agent-architecture.md`
  conservan referencias a Claude y despliegue. Para AI Setter rige este contrato
  junto a AGENTS y constitución; no se modificaron por el límite de esta sesión.
- `memory/MEMORY.md` no existe en la ruta referida; no se creó memoria adicional.
  El estado inicial se conserva en estos documentos, sin afirmar búsqueda exhaustiva.
- El modelo gratuito variable impide comparar calidad solo por el nombre del alias.
  Las condiciones comerciales y umbrales son propuestas hasta aprobación.
- Un prompt correcto no garantiza salida correcta. El E2E determinista verifica
  integración; el corpus generado permite evaluar conducta con evidencia.
- Una rama remota no incorpora el estado de BD. Sin seed sintético y setup limpio,
  Cloud queda bloqueado aunque el build pase.
- La política escrita no es un control técnico de red ni una regla de protección
  de ramas. T04 debe comprobar permisos/automatismos antes de publicar cambios.

Decisiones de esta entrega: priorizar reproducibilidad antes de extender producto;
conservar arquitectura y cambios previos; no inventar política de encaje/reserva/
seguimiento; aprobación por hito; solo documentación. Justificación: aprovechar
beta ya implementada y convertir su evidencia en una base portable y supervisable.
