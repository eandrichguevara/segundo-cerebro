# 🤖 Agent Context & Memory (Proyecto: Backend)

## 🎯 Objetivo del Proyecto

Backend del asistente virtual de voz "Segundo Cerebro". Procesa audio en tiempo real mediante arquitectura de **doble vía**: vía rápida (< 5 s, respuestas inmediatas sin escribir en BD) y vía lenta (< 30 s, lógica de negocio CRUD vía cola PostgreSQL + worker). Gestiona tareas, objetivos, eventos, listas, proyectos, ideas y memoria a largo plazo (RAG con pgvector). Toda la lógica de negocio vive aquí.

## 🛠️ Stack Tecnológico & Restricciones

- **Lenguaje/Entorno:** Node.js 22 + TypeScript (ESNext, strict, path alias `@/`)
- **Framework HTTP/WS:** Fastify + `@fastify/websocket`
- **Base de Datos:** PostgreSQL + pgvector via Prisma ORM
- **Package Manager:** `pnpm` (no npm/yarn)
- **Testing:** Vitest
- **Linting/Typecheck:** Biome + `tsc --noEmit`
- **Logger:** pino (structured JSON)
- **Timezone:** `TIMEZONE` env var, default `America/Santiago` — usado para fechas en prompts LLM
- **IA:** OpenAI (Whisper, GPT-4.1-mini, GPT-5-mini, TTS, text-embedding-3-small)
- **Notificaciones:** Firebase Cloud Messaging (FCM)

## 📐 Arquitectura Propuesta

### Estructura de carpetas

```
src/
  api/          # Controladores HTTP/WebSocket: health, ws, debug, db-viewer
  auth/         # Token estático (MVP, mono-usuario)
  config/       # Variables de entorno (env.ts)
  db/           # Cliente Prisma + repositorios por entidad
  domain/       # Reglas de negocio (task, objective, list, event, project, idea, entity-link, quick-memory, message)
  llm/          # Integraciones OpenAI: STT, fast-lane, slow-lane, TTS, embeddings, prompts
  notifications/# Firebase Cloud Messaging + notifier
  types/        # Tipos compartidos (Result<T,E>, display.ts)
  workers/      # Procesador de cola PostgreSQL (vía lenta, action handlers)
```

### Doble vía (flujo detallado)

**Vía rápida**:

1. Audio del usuario capturado como `audio_chunk` (PCM 16-bit, 16kHz, mono) → servidor vía WebSocket.
2. Servidor acumula chunks, al recibir `audio_end` envía el buffer a Whisper.
3. Texto transcrito → Quick Memory + fast-lane LLM (modelo configurable via `OPENAI_FAST_MODEL`) → respuesta textual.
4. Respuesta enviada al cliente vía WebSocket (`text` + `audio_end` para cerrar turno).
5. Tras cada respuesta exitosa, la vía rápida actualiza el buffer de conversación en Quick Memory via `appendConversation()`.
6. Mensajes `processing` enviados mientras la vía lenta procesa.
7. Si falla (timeout/error): envía "Un momento, estoy procesando..." + `audio_end`.

**Vía lenta**:

1. Texto transcrito encolado en tabla `jobs` (PostgreSQL).
2. Worker consume con `SELECT ... FOR UPDATE SKIP LOCKED`.
3. Envía contexto al slow-lane LLM (modelo configurable via `OPENAI_SLOW_MODEL`): últimos N conversation_turns + top-K memorias + objetivos activos + tareas activas + listas activas + eventos próximos (7 días).
4. LLM devuelve array de acciones JSON → worker ejecuta secuencialmente.
5. Cada acción produce `action_result` enviado al cliente.

### WebSocket Protocol (MVP)

Formato básico de mensajes. Todos incluyen `"version": "1"`. Los mensajes cliente→servidor incluyen `"id"` (UUID v4) como correlation ID.

```json
// Cliente → Servidor
{ "version": "1", "id": "<uuid-v4>", "type": "audio_chunk", "data": "<base64>" }
{ "version": "1", "id": "<uuid-v4>", "type": "audio_end" }
{ "version": "1", "id": "<uuid-v4>", "type": "auth", "token": "<token>", "audio_format": "mp3" }
{ "version": "1", "id": "<uuid-v4>", "type": "register_fcm_token", "token": "<fcm-token>", "platform": "ios|android" }

// Servidor → Cliente
{ "version": "1", "type": "auth_ok", "session_id": "<uuid-v4>", "audio_format": "mp3", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "audio_chunk", "data": "<base64>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "audio_end", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "text", "content": "<texto>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "processing", "content": "<texto>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "action_result", "ok": true, "action": "<action_name>", "correlation_id": "<uuid-v4>", "payload": { ... } }
{ "version": "1", "type": "error", "code": "<code>", "message": "...", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "display", "entities": [...], "correlation_id": "<uuid-v4>" }
```

**Códigos de error**: `AUTH_FAILED`, `STT_ERROR`, `LLM_TIMEOUT`, `TTS_ERROR`, `RATE_LIMITED`, `INVALID_MESSAGE`, `INTERNAL_ERROR`.

**Idempotencia**: deduplicación por `id` en mensajes discretos (no `audio_chunk`). Cache de últimos N ids (configurable via `ID_CACHE_SIZE`/`ID_CACHE_TTL_MS`).

**Reconexión**: backoff exponencial (1s→30s cap). Nuevo `session_id` al reconectar. No reenvío de chunks anteriores.

### Job Queue (PostgreSQL)

Tabla `jobs` para la cola de vía lenta:

| Campo            | Tipo                      | Descripción                                                           |
| ---------------- | ------------------------- | --------------------------------------------------------------------- |
| `id`             | UUID PK                   | Identificador único                                                   |
| `correlation_id` | UUID NOT NULL             | Trazabilidad end-to-end                                               |
| `session_id`     | UUID NOT NULL             | Sesión WebSocket origen                                               |
| `type`           | TEXT NOT NULL             | `process_message`                                                     |
| `source`         | TEXT NOT NULL             | `websocket`, `scheduled`, `system`                                    |
| `payload`        | JSONB NOT NULL            | Datos del mensaje (`transcribed_text`, `audio_format`, `received_at`) |
| `status`         | TEXT NOT NULL             | `pending`, `processing`, `completed`, `failed`                        |
| `attempts`       | INTEGER DEFAULT 0         | Número de intentos                                                    |
| `max_attempts`   | INTEGER DEFAULT 3         | Reintentos máximos                                                    |
| `run_at`         | TIMESTAMPTZ DEFAULT NOW() | Disponible para procesar desde                                        |
| `locked_at`      | TIMESTAMPTZ nullable      | Cuándo el worker tomó el job                                          |
| `locked_by`      | TEXT nullable             | Worker que procesa                                                    |
| `result`         | JSONB nullable            | Resultado del procesamiento                                           |

**Mecanismo**: workers consumen con `SELECT ... FOR UPDATE SKIP LOCKED WHERE status = 'pending' AND run_at <= NOW()`.

**Recovery**: jobs en `processing` con `locked_at` > `JOB_ORPHAN_TIMEOUT_MS` (default: 10 min) se consideran huérfanos. Worker de cleanup corre cada 5 min y los revierte a `pending`.

**Workers**:

- `slow-lane-processor.ts`: consume jobs de la tabla `jobs` con `SELECT ... FOR UPDATE SKIP LOCKED`
- `event-alert-worker.ts`: worker independiente (no job queue) que cada 60s consulta eventos activos y envía notificaciones FCM push con entidades enlazadas. Cache en memoria con timestamps para refresco periódico (`EVENT_NOTIFICATION_REFRESH_MS`, default 5 min, mínimo 30s).

Ambos corren en el mismo proceso Fastify como `setInterval`. Escalar a proceso separado requiere actualizar este archivo.

### Quick Memory (Implementación)

Singleton en RAM (`backend/src/domain/quick-memory.ts`).

```typescript
interface QuickMemoryData {
	whoAmI: string;
	topData: {
		tasks: string[];
		objectives: string[];
		lists: string[];
		events: string[];
		projects: string[];
		ideas: string[];
	};
	todayContext: {
		dueToday: string[];
		inProgress: string[];
		recentMentions: string;
	};
	recentTopics: string;
	recentConversation: string[];
	lastTopics: string;
	updatedAt: Date;
}
```

`formatForPrompt()` genera string < 700 tokens (~2800 chars) con 6 secciones. Si excede, trunca en orden: Conversación reciente → Temas recientes → Hoy → Data clave + Quién soy (siempre preservados).

Actualizada por:
- **Vía rápida**: `appendConversation(userMsg, assistantMsgs)` — buffer in-memory de últimos 6 exchanges (usuario + asistente), llamado tras cada respuesta exitosa
- **Vía lenta**: `update_quick_memory` (contexto general desde BD) y `update_conversation_topics` (últimas 2 temáticas)

**whoAmI** se infiere de memorias con `interaction_type: preference_declaration`. **recentTopics** extrae keywords por frecuencia léxica de últimas 3 memorias (largo plazo). **lastTopics** lo setea la vía lenta (corto plazo, conversación actual). **recentConversation** se mantiene en memoria por la vía rápida.

Funciones exportadas: `update()`, `get()`, `isEmpty()`, `formatForPrompt()`, `appendConversation()`, `clearConversation()`, `updateLastTopics()`.

**Ubicación**: `backend/src/domain/quick-memory.ts`, `backend/src/workers/action-handlers.ts` (handleUpdateQuickMemory, handleUpdateConversationTopics), `backend/src/api/ws.ts` (appendConversation, clearConversation), `backend/src/llm/prompts/fast-lane-system.ts`, `backend/src/llm/prompts/slow-lane-system.ts` (regla de tema).

### Acciones de la vía lenta

La vía lenta produce un array de acciones JSON que el worker ejecuta secuencialmente. Formato base:

```json
{
  "action": "nombre_de_la_accion",
  "payload": { ... },
  "depends_on": 0  // opcional, índice 0-based de acción de la que depende
}
```

**Reglas**:

1. La vía lenta produce **una o más acciones** por mensaje en `{ "actions": [...] }`.
2. Acciones sin `depends_on` se ejecutan siempre. Si `depends_on` referencia una acción que falló, recibe error `PREVIOUS_ACTION_FAILED`.
3. Si el mensaje es ambiguo, elegir la acción más probable y notificar.
4. Si no mapea a ninguna acción, enviar `store_memory`.
5. Para preguntas informativas, usar `respond` en vez de `store_memory`.

#### `create_task`

| Campo          | Tipo   | Requerido | Descripción                                   |
| -------------- | ------ | --------- | --------------------------------------------- |
| `title`        | string | Sí        | Título breve                                  |
| `description`  | string | No        | Descripción detallada                         |
| `due_date`     | string | No        | Fecha límite ISO 8601                         |
| `objective_id` | string | No        | UUID del objetivo                             |
| `priority`     | string | No        | `low`, `medium`, `high` (default: `medium`)   |
| `context`      | object | No        | Metadata estructurada (ubicación, hora, etc.) |

```json
{
	"action": "create_task",
	"payload": {
		"title": "Revisar presupuesto mensual",
		"priority": "high",
		"due_date": "2026-05-25T23:59:59Z"
	}
}
```

#### `start_task`

| Campo     | Tipo   | Requerido | Descripción      |
| --------- | ------ | --------- | ---------------- |
| `task_id` | string | Sí        | UUID de la tarea |

Transición: `pending` → `in_progress` o `postponed` → `in_progress`.

#### `update_task`

| Campo                                                                     | Tipo   | Requerido | Descripción                           |
| ------------------------------------------------------------------------- | ------ | --------- | ------------------------------------- |
| `task_id`                                                                 | string | Sí        | UUID de la tarea                      |
| `title`, `description`, `due_date`, `objective_id`, `priority`, `context` | varios | No        | Campos a actualizar (patch semántico) |

#### `complete_task` / `cancel_task`

| Campo     | Tipo   | Requerido | Descripción      |
| --------- | ------ | --------- | ---------------- |
| `task_id` | string | Sí        | UUID de la tarea |

#### `postpone_task`

| Campo      | Tipo   | Requerido | Descripción                 |
| ---------- | ------ | --------- | --------------------------- |
| `task_id`  | string | Sí        | UUID de la tarea            |
| `due_date` | string | Sí        | Nueva fecha límite ISO 8601 |

Transiciona a `postponed`.

#### `create_objective`

| Campo         | Tipo   | Requerido | Descripción           |
| ------------- | ------ | --------- | --------------------- |
| `title`       | string | Sí        | Título breve          |
| `description` | string | No        | Descripción detallada |
| `deadline`    | string | No        | Fecha límite ISO 8601 |

#### `update_objective`

| Campo                              | Tipo   | Requerido | Descripción                           |
| ---------------------------------- | ------ | --------- | ------------------------------------- |
| `objective_id`                     | string | Sí        | UUID del objetivo                     |
| `title`, `description`, `deadline` | varios | No        | Campos a actualizar (patch semántico) |

#### `complete_objective`

| Campo          | Tipo   | Requerido | Descripción       |
| -------------- | ------ | --------- | ----------------- |
| `objective_id` | string | Sí        | UUID del objetivo |

Validación: no debe tener tareas en estado `pending` o `in_progress`.

#### `cancel_objective`

| Campo          | Tipo   | Requerido | Descripción       |
| -------------- | ------ | --------- | ----------------- |
| `objective_id` | string | Sí        | UUID del objetivo |

Efecto cascada: todas sus tareas `pending`, `in_progress`, `postponed` pasan a `cancelled`.

#### `pause_objective` / `resume_objective`

| Campo          | Tipo   | Requerido | Descripción       |
| -------------- | ------ | --------- | ----------------- |
| `objective_id` | string | Sí        | UUID del objetivo |

#### `store_memory`

| Campo      | Tipo   | Requerido | Descripción                               |
| ---------- | ------ | --------- | ----------------------------------------- |
| `content`  | string | Sí        | Texto resumido de la interacción          |
| `metadata` | object | No        | `interaction_type`, `entities`, `context` |

```json
{
	"action": "store_memory",
	"payload": {
		"content": "El usuario prefiere hacer tareas los martes",
		"metadata": { "interaction_type": "preference_declaration" }
	}
}
```

Flujo: worker genera embedding de `content` con `text-embedding-3-small` e inserta en `memories`.

#### `create_list`

| Campo         | Tipo   | Requerido | Descripción                                    |
| ------------- | ------ | --------- | ---------------------------------------------- |
| `title`       | string | Sí        | Título de la lista                             |
| `type`        | string | No        | `shopping`, `ingredients`, `general` (default) |
| `description` | string | No        | Descripción                                    |
| `items`       | array  | No        | `[{ content, quantity? }]`                     |

#### `add_list_items`

| Campo     | Tipo   | Requerido | Descripción                |
| --------- | ------ | --------- | -------------------------- |
| `list_id` | string | Sí        | UUID de la lista           |
| `items`   | array  | Sí        | `[{ content, quantity? }]` |

Siempre agrega al array existente, no reemplaza.

#### `check_list_item` / `uncheck_list_item`

| Campo        | Tipo   | Requerido | Descripción      |
| ------------ | ------ | --------- | ---------------- |
| `list_id`    | string | Sí        | UUID de la lista |
| `item_index` | number | Sí        | Índice 0-based   |

#### `complete_list` / `cancel_list`

| Campo     | Tipo   | Requerido | Descripción      |
| --------- | ------ | --------- | ---------------- |
| `list_id` | string | Sí        | UUID de la lista |

Validación en `complete_list`: todos los items deben estar `checked` (o lista vacía).

#### `create_event`

| Campo             | Tipo   | Requerido | Descripción                          |
| ----------------- | ------ | --------- | ------------------------------------ |
| `title`           | string | Sí        | Título del evento                    |
| `start_time`      | string | Sí        | Inicio ISO 8601                      |
| `end_time`        | string | No        | Fin ISO 8601                         |
| `description`     | string | No        | Descripción                          |
| `location`        | string | No        | Ubicación                            |
| `category`        | string | No        | `trabajo`, `personal`, `salud`, etc. |
| `recurrence_rule` | object | No        | Regla de recurrencia                 |

**`recurrence_rule`**: `{ frequency: "daily"|"weekly"|"monthly"|"yearly", interval?: number, daysOfWeek?: number[], dayOfMonth?: number, monthOfYear?: number, endDate?: string, count?: number }`.

#### `update_event`

| Campo                                                                    | Tipo   | Requerido | Descripción                           |
| ------------------------------------------------------------------------ | ------ | --------- | ------------------------------------- |
| `event_id`                                                               | string | Sí        | UUID del evento                       |
| `title`, `description`, `location`, `category`, `start_time`, `end_time` | varios | No        | Campos a actualizar (patch semántico) |

#### `delete_event` / `query_events` / `move_event_instance` / `update_recurrence_rule`

Ver schemas completos en `backend/src/workers/action-handlers.ts`. Todos usan `event_id` o rango de fechas.

#### `create_project`

| Campo         | Tipo   | Requerido | Descripción                 |
| ------------- | ------ | --------- | --------------------------- |
| `title`       | string | Sí        | Título                      |
| `description` | string | No        | Descripción                 |
| `category`    | string | No        | `trabajo`, `personal`, etc. |
| `deadline`    | string | No        | Fecha límite ISO 8601       |

#### `update_project` / `complete_project` / `cancel_project` / `pause_project` / `resume_project`

Todas usan `project_id` (UUID) como identificador. `update_project` acepta `title`, `description`, `category`, `deadline`.

#### `create_idea`

| Campo         | Tipo     | Requerido | Descripción     |
| ------------- | -------- | --------- | --------------- |
| `title`       | string   | Sí        | Título          |
| `description` | string   | No        | Descripción     |
| `tags`        | string[] | No        | Tags/categorías |

Estados: `new_idea` → `evaluating` → `approved` / `discarded` (irreversible). `approved` → `converted`.

#### `update_idea` / `evaluate_idea` / `approve_idea` / `discard_idea` / `convert_idea`

Todas usan `idea_id` (UUID). `update_idea` acepta `title`, `description`, `tags`.

#### `link_entities`

| Campo         | Tipo   | Requerido | Descripción                                                           |
| ------------- | ------ | --------- | --------------------------------------------------------------------- |
| `source_type` | string | Sí        | `task`, `objective`, `project`, `idea`, `list`, `event`               |
| `source_id`   | string | Sí        | UUID origen                                                           |
| `target_type` | string | Sí        | Tipo destino                                                          |
| `target_id`   | string | Sí        | UUID destino                                                          |
| `relation`    | string | No        | `related` (default), `part_of`, `depends_on`, `inspired_by`, `blocks` |
| `note`        | string | No        | Nota opcional                                                         |

#### `unlink_entities` / `query_links`

`unlink_entities`: mismo schema sin `relation`/`note`. `query_links`: `{ entity_type, entity_id }`.

#### `respond`

| Campo  | Tipo   | Requerido | Descripción                  |
| ------ | ------ | --------- | ---------------------------- |
| `text` | string | Sí        | Respuesta natural en español |

Responde al usuario con texto conversacional usando contexto. **No** almacenar información (usar `store_memory`). Puede incluir `display` opcional con entidades estructuradas.

#### `update_conversation_topics`

| Campo    | Tipo   | Requerido | Descripción                                       |
| -------- | ------ | --------- | ------------------------------------------------- |
| `topics` | string | Sí        | Últimas 2 temáticas de conversación (separadas por coma) |

Acción interna (sin mensaje al usuario). La vía lenta la determina al inicio del array de acciones, basándose en el análisis de la conversación actual. Actualiza `lastTopics` en el Quick Memory para que la vía rápida tenga contexto temático.

```json
{
	"action": "update_conversation_topics",
	"payload": { "topics": "presupuesto, compras supermercado" }
}
```

#### `query_list`

| Campo        | Tipo   | Requerido | Descripción                                                                            |
| ------------ | ------ | --------- | -------------------------------------------------------------------------------------- |
| `list_title` | string | No        | Nombre de lista (case-insensitive, partial match). Si omite, retorna todas las activas |

#### Códigos de error de acción

| Código                        | Descripción                                       |
| ----------------------------- | ------------------------------------------------- |
| `TASK_NOT_FOUND`              | No existe tarea con ese ID                        |
| `OBJECTIVE_NOT_FOUND`         | No existe objetivo con ese ID                     |
| `INVALID_STATE_TRANSITION`    | Transición no permitida por la máquina de estados |
| `OBJECTIVE_HAS_PENDING_TASKS` | El objetivo tiene tareas pendientes               |
| `LIST_NOT_FOUND`              | No existe lista con ese nombre o ID               |
| `AMBIGUOUS_MATCH`             | Múltiples listas coinciden                        |
| `LIST_HAS_UNCHECKED_ITEMS`    | Lista con items sin completar                     |
| `INVALID_ITEM_INDEX`          | Índice fuera del array                            |
| `MISSING_REQUIRED_FIELD`      | Campo requerido faltante                          |
| `PREVIOUS_ACTION_FAILED`      | Acción dependiente falló                          |
| `EVENT_NOT_FOUND`             | No existe evento                                  |
| `INVALID_RECURRENCE_RULE`     | Regla de recurrencia inválida                     |
| `CANNOT_MODIFY_COMPLETED`     | Tarea ya completada                               |
| `CANNOT_MODIFY_CANCELLED`     | Tarea ya cancelada                                |
| `UNKNOWN_ACTION`              | Acción no registrada en el router                 |

### AI Integrations

**STT (Whisper)**: modelo `whisper-1`. Solo transcribe, no mezclar con lógica de negocio.

**Fast Lane**: modelo configurable via `OPENAI_FAST_MODEL` (default: `gpt-4.1-mini`). Usa `max_completion_tokens` (no `max_tokens`) para compatibilidad GPT-5. Timeout configurable via `FAST_LANE_TIMEOUT_MS` (default 5000 ms).

**Slow Lane**: modelo configurable via `OPENAI_SLOW_MODEL` (default: `gpt-5-mini`). Usa `max_completion_tokens`. Timeout configurable via `SLOW_LANE_MAX_TOKENS` (default 4000).

**TTS**: Cartesia Sonic (`sonic-3.5`, ~150ms first token) como provider principal. OpenAI `tts-1-hd` (voz `nova`) como fallback. Config via `TTS_PROVIDER`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`.

**Embeddings**: `text-embedding-3-small` (1536 dim). Usado para RAG en memorias.

**Prompts**: versionados en `backend/src/llm/prompts/`. Archivos: `fast-lane-system.ts`, `slow-lane-system.ts`, `slow-lane-actions.ts`. Variables de template: `{{user_context}}`, `{{recent_memories}}`, `{{active_objectives}}`, `{{active_tasks}}`, `{{active_lists}}`, `{{conversation_turns}}`, `{{upcoming_events}}`. Los prompts **siempre** viven en código versionado, nunca en BD.

### Display estructurado (Backend)

Tipos en `backend/src/types/display.ts`:

- `TaskDisplay`: type, title, priority, status, dueDate?
- `ListDisplay`: type, title, items[{content, quantity?, checked}]
- `ObjectiveDisplay`: type, title, status, deadline?
- `EventDisplay`: type, title, startTime, endTime?, location?, recurrence?, category?
- `MemoryDisplay`: type, content

El LLM genera `display` en la acción `respond` → worker envía mensaje WS `display` separado → Flutter renderiza widgets nativos.

### Logging

- **Librería**: pino, integrado con Fastify.
- **Niveles**: `fatal`, `error`, `warn`, `info` (incluir `correlation_id`), `debug`, `trace` (solo desarrollo).
- **Regla**: nunca exponer secretos, tokens, transcripciones completas ni embeddings en logs.

### Manejo de errores

- Fast lane: si falla timeout, respuesta genérica + vía lenta responde.
- Slow lane: reintentos con backoff exponencial (base 2s, multiplicador 2, jitter ±20%), hasta 3 intentos.
- Acciones fallidas: solo las que tienen `depends_on` hacia la fallida reciben `PREVIOUS_ACTION_FAILED`. Las demás se ejecutan normalmente.
- Nunca exponer detalles de errores internos al cliente.

### Autenticación y rate limiting

- **Auth**: token estático via variable de entorno `AUTH_TOKEN`. Primer mensaje WS debe ser `auth` con el token. Sin endpoint REST de registro. Mono-usuario.
- **Rate limiting**: `RATE_LIMIT_AUDIO` (default 50 msgs/seg para `audio_chunk`), `RATE_LIMIT_OTHER` (10 msgs/seg para otros).
- **Seguridad**: validación de schema en cada mensaje, `type` debe ser valor permitido, `data` ≤ `WS_MAX_PAYLOAD` (default 1 MB). Timeout de inactividad `WS_IDLE_TIMEOUT_MS` (default 5 min).

### Health checks

`GET /health` devuelve `{ status: "ok"|"degraded", timestamp, database, jobs }`. Verifica conexión PostgreSQL.

Métricas internas en memoria: latencia P95 de vía rápida/lenta, jobs por estado, tasa de error por integración. Logueadas cada 60 segundos a nivel `info`.

## 🚦 Estado Actual e Hitos de Automatización

- [x] **Fase 1 (MVP)**: WebSocket auth, STT (Whisper), doble vía, CRUD tasks/objectives/lists/events/projects/ideas/links, Quick Memory, display estructurado, cola PostgreSQL, FCM.
- [x] **Fase 2 — Memoria (parcial)**: RAG con pgvector (top-K), notificaciones proactivas, tests de RAG.
- [ ] **Fase 2 — pendiente**: Consolidación periódica de memorias.
- [ ] **Fase 3**: Personal avanzado (inferencia de personalidad, métricas, ajuste dinámico de prompts).
- [ ] **Fase 4**: Docker/OCI, CI/CD, job queue escalable (Graphile Worker/BullMQ).

## 📌 Reglas Generales para el Agente (Modo Build)

1. Ejecuta `pnpm lint` (typecheck + Biome) y `pnpm test` antes de dar cualquier cambio por terminado.
2. Usa siempre `pnpm`, no npm/yarn.
3. Sigue el patrón `Result<T, E>` en `domain/`. Nunca uses `any`, `as unknown as T`, `!`, ni `@ts-ignore`. Prefiere discriminated unions y narrowing explícito.
4. Respeta la separación estricta: vía rápida **nunca** escribe en BD (solo `conversation_turns` y encolado de jobs). Vía lenta **siempre** aplica lógica de negocio.
5. Naming: `camelCase` en TS, `snake_case` en BD, `kebab-case.ts` en archivos. Imports agrupados: externos → `@/` → relativos.
6. Logs con pino, incluye `correlation_id`. Nunca expongas secretos, tokens ni transcripciones completas en logs.
7. No introduzcas dependencias externas sin preguntar. No acoples lógica de UI móvil en el backend.
8. Si el cambio afecta el flujo de doble vía, modelo de datos o integraciones IA, actualiza también el `AGENTS.md` raíz.
9. Para cambios en acciones vía lenta, actualizar schemas y ejemplos en este archivo.
10. Los prompts siempre van en `backend/src/llm/prompts/`, versionados en código.
