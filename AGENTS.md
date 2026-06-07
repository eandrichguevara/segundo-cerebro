# 🤖 Agent Context & Memory (Proyecto: Segundo Cerebro)

## 🎯 Objetivo del Proyecto

Asistente virtual de voz en tiempo real, personal y mono-usuario, que actúa como "Segundo Cerebro" del usuario. Gestiona tareas, objetivos y rutinas replicando la personalidad del usuario.

**Nombre del asistente**: Toph (se pronuncia "tof")

Interfaz **voice-first**, sin dashboards. La app móvil es solo un cliente de voz; toda la lógica vive en el backend.

**Invariantes permanentes:**

- Doble vía de procesamiento (rápida sin lógica, lenta con lógica de negocio)
- Mono-usuario, no se contempla multi-usuario
- Token estático para auth (MVP)
- El sistema **no** es complaciente — replica la personalidad del usuario, no la valida

## 🛠️ Stack Tecnológico & Restricciones

| Capa              | Tecnología                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Cloud             | Oracle Cloud Infrastructure (OCI) Free Tier, instancia ARM 24 GB RAM                                        |
| Runtime           | Node.js + TypeScript                                                                                        |
| Framework HTTP/WS | Fastify                                                                                                     |
| Base de datos     | PostgreSQL + pgvector (memoria a largo plazo / RAG)                                                         |
| ORM               | Prisma                                                                                                      |
| Package manager   | pnpm                                                                                                        |
| STT               | OpenAI Whisper (`whisper-1`)                                                                                |
| LLM vía rápida    | OpenAI (default `gpt-4.1-mini`, configurable via `OPENAI_FAST_MODEL`)                                       |
| LLM vía lenta     | OpenAI (default `gpt-5-mini`, configurable via `OPENAI_SLOW_MODEL`) — lógica, validación, JSON estructurado |
| TTS               | Cartesia Sonic (principal) + OpenAI `tts-1-hd` (fallback)                                                   |
| Embeddings        | OpenAI `text-embedding-3-small`                                                                             |
| Job queue         | PostgreSQL (Fase 1). Escalar a Graphile Worker o BullMQ requiere actualizar este archivo.                   |
| Notificaciones    | Firebase Cloud Messaging (FCM)                                                                              |
| Mobile            | Flutter                                                                                                     |
| Dashboard web     | Next.js + shadcn/ui (solo lectura)                                                                          |
| Logger            | pino (structured JSON)                                                                                      |
| Timezone          | `TIMEZONE` env var, default `America/Santiago` — usado para fechas en prompts LLM                           |

No cambiar estas decisiones sin actualizar este archivo.

## 📐 Arquitectura Propuesta

### Doble vía de procesamiento

**Vía rápida** (< 5 s P95): audio del usuario → Whisper API → texto → Quick Memory (cache RAM) → gpt-4.1-mini → respuesta textual + `audio_end`. **Nunca escribe en BD** (solo `conversation_turns` y encola vía lenta).

**Vía lenta** (< 30 s P95): texto → cola PostgreSQL → worker → gpt-5-mini entiende intención → una o más acciones CRUD → BD → notificación al cliente (WebSocket o FCM).

**Regla fundamental**: la vía rápida **nunca** escribe en BD ni toma decisiones de negocio. Solo confirma recepción.

```
Cliente (Flutter)
  │
  ├── audio_chunks ──► Servidor ──► Whisper ──► texto
  │                                              │
  │                                        Vía rápida ──► texto + audio_end al cliente
  │                                        (gpt-4.1-mini)
  │                                              │
  │ ◄── processing ──────────────────────── eventos de estado
  │                                              │
  │                                        Cola PostgreSQL
  │                                              │
  │                                        Vía lenta ──► CRUD en BD ──► notificación
  │                                        (gpt-5-mini)
  │                                              │
  │ ◄── action_result / display / text ──── respuestas
```

**Event Alert Worker**: worker independiente (no job queue) que cada 60s consulta eventos activos (`start_time <= now AND (end_time IS NULL OR end_time > now)`). Para cada evento activo, resuelve entidades enlazadas (listas, tareas, objetivos) y envía FCM push con `type: "event_notification"`. Cuando el evento termina, envía `type: "event_notification_cancel"` para remover la notificación. Cache en memoria con timestamps para refresco periódico (re-envía cada `EVENT_NOTIFICATION_REFRESH_MS` ms, default 5 min, mínimo 30s) para actualizar entidades enlazadas. Las notificaciones se actualizan in-place en el teléfono (mismo `notificationId`). Las notificaciones son **ongoing** (no descartables) en Android.

### Modo Interview (v0.3.0+)

Modo interactivo donde Toph hace preguntas al usuario para conocerlo mejor y llenar vacíos de información. Activado por botón especial en la app móvil.

**Flujo**:
1. Usuario pulsa botón interview → cliente envía `start_interview`
2. Servidor activa estado de interview y encola job `interview_scan`
3. Worker analiza BD completa y genera plan de preguntas (áreas + prioridades)
4. Toph hace primera pregunta al usuario
5. Usuario responde → vía rápida confirma brevemente → vía lenta procesa respuesta (puede crear entidades) + genera siguiente pregunta
6. Ciclo continúa hasta que usuario pulsa botón de nuevo → `stop_interview`
7. Worker genera memoria resumen de la sesión

**Tipos de job**: `interview_scan`, `interview_response`, `interview_summary`

**Estado**: `InterviewState` en RAM por sesión (plan, historial, pregunta actual). Se pierde al desconectar.

**Variables de entorno**: `INTERVIEW_MAX_QUESTIONS` (default 30), `INTERVIEW_SCAN_MAX_MEMORIES` (default 50)

**Fallback**: si la vía rápida falla en modo interview, usa prompt especializado `INTERVIEW_FAST_LANE_PROMPT`.

**Fallback**: si la vía rápida falla (timeout/error), envía "Un momento, estoy procesando..." + `audio_end`. La vía lenta responde cuando termine.

**Timeouts**: HTTP 10s | WebSocket inactividad 5 min | Vía rápida `FAST_LANE_TIMEOUT_MS` (default 5000 ms) | Vía lenta < 30 s P95

### Quick Memory (Cache en RAM)

Cache en memoria que la vía rápida consulta para responder sin depender de la vía lenta. Máximo 700 tokens (~2800 chars). 6 secciones:

1. **Quién soy** — identidad del usuario inferida de memorias con preferencias
2. **Data clave** — top tareas, objetivos, listas, eventos, proyectos, ideas
3. **Hoy** — lo que vence hoy + en progreso
4. **Temas recientes** — keywords de memorias recientes
5. **Conversación reciente** — historial de los últimos 6 exchanges (usuario + asistente) de la sesión actual, mantenido en memoria por la vía rápida
6. **Últimos temas** — últimas 2 temáticas de conversación, determinadas por la vía lenta vía acción `update_conversation_topics`

Actualizada por:
- **Vía rápida**: `appendConversation(userMsg, assistantMsgs)` — agrega cada exchange al buffer in-memory tras cada respuesta exitosa
- **Vía lenta**: `update_quick_memory` (contexto general) y `update_conversation_topics` (temáticas de conversación)

Prioridad de truncamiento (2800 chars): Conversación reciente > Temas recientes > Hoy > Data clave + Quién soy.

### Modelo de datos

| Entidad              | Propósito                                        | Estados                                                   |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `tasks`              | Unidad atómica de acción                         | pending → in_progress → completed / postponed / cancelled |
| `objectives`         | Meta a corto/mediano/largo plazo                 | active → paused / completed / cancelled                   |
| `lists`              | Colección flexible de items                      | active → completed / cancelled                            |
| `events`             | Evento único o recurrente (con excepciones)      | active → completed / cancelled                            |
| `projects`           | Proyectos con estado                             | active → paused / completed / cancelled                   |
| `ideas`              | Ideas con ciclo de evaluación                    | new → evaluating → approved / discarded → converted       |
| `memories`           | Interacción significativa + embedding vectorial  | Sin soft delete                                           |
| `conversation_turns` | Registro de cada intercambio por sesión          | Sin soft delete                                           |
| `entity_links`       | Enlace genérico entre cualquier par de entidades | —                                                         |
| `jobs`               | Cola de procesamiento de vía lenta               | pending → processing → completed / failed                 |
| `devices`            | Dispositivos registrados para notificaciones FCM | —                                                         |

**Relaciones**: Tarea → Objetivo (FK). Evento recurrente → excepciones (self-reference). Cualquier entidad se vincula con cualquier otra via `entity_links`. Soft delete en tasks, objectives, events, lists, projects (estado `cancelled` + `cancelled_at`).

### Máquinas de estado

**Tasks**:

```
pending ──► in_progress ──► completed
    │            │               │
    ├──► postponed ──► pending   (irreversible)
    │         │                  cancelled
    └──► cancelled (irreversible)
```

**Objectives**:

```
active ──► paused ──► active
  │          └──► cancelled
  ├──► completed (irreversible)
  └──► cancelled
```

Al cancelar un objective, todas sus tareas pendientes/in_progress/postponed pasan a `cancelled` (cascada).

**Lists y Events**:

```
active ──► completed (irreversible)
  └──► cancelled (irreversible)
```

### Personalidad del clon

No tiene personalidad fija. Replica la del usuario infiriéndola de interacciones, decisiones previas y objetivos declarados. **No es complaciente** — la mayoría de los asistentes validan todo; este sistema no. La personalidad se construye progresivamente.

### Memoria a largo plazo (RAG con pgvector)

Cada interacción significativa → texto resumido + embedding (`text-embedding-3-small`, 1536 dim, índice HNSW). La vía lenta consulta top-K memorias relevantes como contexto para gpt-5-mini, junto con los últimos N conversation_turns de la sesión. Las memorias no se eliminan automáticamente; se consolidan periódicamente (Fase 2).

### Display estructurado

**Capa 1 — Emojis**: los prompts del LLM usan emojis (🔴🟡🟢 prioridades, ✅☐ estados, 📅🎯🧠 entidades).

**Capa 2 — Display nativo**: la acción `respond` puede incluir `display` en su payload con entidades estructuradas (`TaskDisplay`, `ListDisplay`, `ObjectiveDisplay`, `EventDisplay`, `MemoryDisplay`) para renderizado nativo en Flutter vía mensaje WS `display`.

### Estructura del proyecto

```
backend/
  src/
    api/            # Controladores HTTP/WS (Fastify)
    auth/           # Token estático (MVP)
    config/         # Variables de entorno
    db/             # Prisma + repositorios
    domain/         # Reglas de negocio + Result<T,E>
    llm/            # OpenAI, Cartesia, prompts versionados
    notifications/  # Firebase Cloud Messaging
    types/          # Tipos compartidos, display.ts
    workers/        # Cola PostgreSQL (vía lenta)
  prisma/           # Schema + seed
appmovil/           # Cliente Flutter voice-first
web/                # Dashboard Next.js (solo lectura)
deploy/             # Docker Compose + nginx
```

No mover carpetas de alto nivel sin instrucción explícita.

## 🚦 Estado Actual e Hitos de Automatización

| Fase | Nombre                | Estado                                                                                                                                                        |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **MVP**               | ✅ Completada — WebSocket, STT, doble vía, CRUD tasks/objectives/lists/events/projects/ideas/links, Quick Memory, display estructurado, cola PostgreSQL, FCM. |
| 2    | **Memoria**           | 🟡 Casi completa — RAG con pgvector, notificaciones proactivas y modo interview funcionando. Pendiente: consolidación periódica de memorias.                   |
| 3    | **Personal avanzado** | ⬜ Pendiente — inferencia de personalidad, métricas de uso, ajuste dinámico de prompts.                                                                       |
| 4    | **Producción**        | ⬜ Pendiente — Docker/OCI, CI/CD, monitoreo, job queue escalable (Graphile Worker/BullMQ).                                                                    |

Detalle de implementación por capa en `backend/AGENTS.md`, `appmovil/AGENTS.md`, `web/AGENTS.md`.

## 📌 Reglas Generales para el Agente (Modo Build)

### Cross-project

1. **pnpm** es el package manager (no npm/yarn). En web también.
2. **TypeScript strict**: no `any`, `as unknown as T`, non-null assertion `!`, `@ts-ignore`. Preferir discriminated unions y narrowing explícito.
3. **Naming**: `camelCase` en TS, `snake_case` en BD, `kebab-case.ts` en archivos. Modelos Prisma en `PascalCase` (inglés). Imports: externos → `@/` → relativos, separados por línea en blanco.
4. **Logs** con pino, incluir `correlation_id`. Nunca exponer secretos, tokens ni transcripciones completas.
5. **Testing**: un archivo `.test.ts` por cada archivo de producción en el mismo directorio.
6. **Commits**: Conventional Commits. No forzar push ni commitear sin revisar diff previamente.

### Arquitectura

7. **Doble vía**: respetar separación estricta. Vía rápida nunca escribe en BD (solo conversation_turns y encolar jobs). Vía lenta aplica toda la lógica de negocio.
8. **Result pattern** en `domain/`: `Result<T, E>` con helpers `ok(value)` / `err(error)`. Errores como enums por dominio.
9. **Prompts versionados** en `backend/src/llm/prompts/`, nunca en BD ni archivos externos.

### Mantenimiento

10. Si un cambio afecta doble vía, modelo de datos, integraciones IA, protocolo WS o personalidad del clon: actualizar este AGENTS.md y los relevantes por capa.
11. Ejecutar `pnpm lint` y `pnpm test` antes de dar un cambio por terminado en backend.
12. Para Flutter: ejecutar `flutter test` antes de terminar.
13. No introducir dependencias externas sin preguntar.

### Safety

14. No leer ni mostrar `.env`, claves o configuraciones sensibles.
15. No desactivar validaciones que impiden escritura directa en BD desde vía rápida.
16. No modificar infraestructura de despliegue (docker, nginx, OCI) sin instrucción explícita.
