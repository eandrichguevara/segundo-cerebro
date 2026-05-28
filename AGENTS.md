# Segundo Cerebro / Clon Virtual – AGENTS.md

## Project overview

Asistente virtual de voz en tiempo real, personal y mono-usuario, que actúa como "Segundo Cerebro" del usuario. Gestiona tareas, objetivos y rutinas replicando la personalidad del usuario.

Interfaz: **voice-first**, sin dashboards. La app móvil es solo un cliente de voz; toda la lógica vive en el backend. El sistema está diseñado para un único usuario; no se contempla multi-usuario.

## Tech stack

| Capa              | Tecnología                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Cloud             | Oracle Cloud Infrastructure (OCI) Free Tier, instancia ARM 24 GB RAM                                        |
| Runtime           | Node.js + TypeScript                                                                                        |
| Framework HTTP/WS | Fastify                                                                                                     |
| Base de datos     | PostgreSQL + pgvector (memoria a largo plazo / RAG)                                                         |
| ORM               | Prisma                                                                                                      |
| Package manager   | pnpm                                                                                                        |
| STT               | OpenAI Whisper (`whisper-1`)                                                                                |
| LLM vía rápida    | OpenAI (default `gpt-5-nano`, configurable via `OPENAI_FAST_MODEL`)                                         |
| TTS               | OpenAI `tts-1-hd` (voz `nova`) — función existente pero no integrada en el flujo de producción              |
| LLM vía lenta     | OpenAI (default `gpt-5-mini`, configurable via `OPENAI_SLOW_MODEL`) — lógica, validación, JSON estructurado |
| Embeddings        | OpenAI `text-embedding-3-small`                                                                             |
| Job queue         | PostgreSQL (Fase 1). Escalar a Graphile Worker o BullMQ requiere actualizar este archivo.                   |
| Audio móvil       | WebRTC (`flutter_webrtc`) — micrófono continuo, reproducción automática, sin push-to-talk                   |
| Notificaciones    | Firebase Cloud Messaging (FCM)                                                                              |
| Mobile            | Flutter                                                                                                     |
| Auth (MVP)        | Token único estático                                                                                        |
| Logger            | pino (structured JSON)                                                                                      |

No cambiar estas decisiones sin actualizar este archivo.

## Architecture

### Doble vía de procesamiento

**Vía rápida** (latencia < 5 s, SLA P95):

1. Audio del usuario capturado como `audio_chunk` (PCM 16-bit, 16kHz, mono) → servidor vía WebSocket.
2. Servidor acumula chunks, al recibir `audio_end` envía el buffer completo a OpenAI Whisper API (`whisper-1`) para transcripción.
3. Texto transcrito → se inyecta **Quick Memory** (contexto resumido en < 700 tokens desde cache en RAM) + OpenAI (modelo configurable via `OPENAI_FAST_MODEL`, default `gpt-5-nano`) para respuesta textual rápida.
4. Respuesta de texto enviada al cliente vía WebSocket (`text` + `audio_end` para cerrar el turno).
5. Eventos (transcript) enviados por WebSocket de control.

Objetivo: mantener conversación fluida, con respuesta en < 5 s. **Sin escritura directa en base de datos** (excepto `conversation_turns` y encolado de la vía lenta). La vía rápida puede responder preguntas simples usando la Quick Memory sin depender de la vía lenta.

**Vía lenta** (latencia < 30 s P95, SLA):

1. Texto transcrito → cola PostgreSQL.
2. Worker consume mensaje → OpenAI gpt-5-mini:
   - Entiende intención del usuario.
   - Mapea a entidades de la base de datos.
   - Aplica reglas de negocio.
   - Genera JSON estructurado con una o más acciones CRUD.
3. Resultado → escritura en base de datos + notificación al usuario si corresponde.

**Regla fundamental**: la vía rápida **nunca** escribe en la base de datos ni toma decisiones de negocio. Solo confirma recepción.

### Fallback de la vía rápida

Si la vía rápida falla (timeout de `gpt-5-nano` o error de `whisper-1`):

- El servidor envía `text` con "Un momento, estoy procesando..." y `audio_end` para cerrar el turno.
- El cliente transiciona a `idle` y puede enviar nuevo audio.
- La vía lenta sigue procesando el mensaje desde la cola PostgreSQL y responderá cuando esté listo.

### Diagrama de flujo

```
Cliente (Flutter)
  │
  ├── audio_chunks (WebSocket) ──► Servidor ──► Whisper API (whisper-1)
  │       (audio PCM 16-bit, 16kHz)       │           → texto transcrito
  │                                        │                │
  │                                        │         Vía rápida: gpt-5-nano
  │                                        │         → respuesta textual
  │                                        │                │
  │ ◄── WebSocket text + audio_end ◄──────┘          respuesta texto
  │ ◄── WebSocket control ◄────────────────────── eventos (transcript)
  │                                                  │
  │                                         ┌────────┴────────┐
  │                                         │                  │
  │                                    Vía rápida          Vía lenta
  │                                    (gpt-5-nano)   Cola PostgreSQL
  │                                         │                  │
  │                                  respuesta texto    Worker consume
  │                                    + audio_end           │
  │                                         │            GPT‑5-mini procesa
  │                                         │                │
  │                                     texto → cliente  CRUD en BD
  │                                                         │
  │                                              ┌──────────┴──────────┐
  │                                              │                     │
  │                                        WebSocket/FCM         RAG (embeddings)
  │                                        notificación          contexto futuro
  │                                        → cliente
```

### Timeouts

- Request HTTP: 10 s
- WebSocket inactividad: 5 min (sin mensajes → desconectar)
- Vía rápida (Whisper + gpt-5-nano): < 5 s P95
- Vía lenta (cola → worker → BD → notificación): < 30 s P95
- Vía rápida timeout absoluto: configurable via `FAST_LANE_TIMEOUT_MS` (default: 5000 ms)

### Flujo de resultado de la vía lenta

1. Al comenzar el procesamiento, el worker envía un mensaje `processing` al cliente (ej: "Buscando..."). TTS no está integrado en el flujo de producción actual; la respuesta se envía solo como texto.
2. Worker procesa las acciones secuencialmente. Cada acción produce un `action_result`.
3. Cada acción se ejecuta independientemente a menos que tenga el campo `depends_on` especificado. Si `depends_on` referencia una acción que falló, esa acción recibe `PREVIOUS_ACTION_FAILED` y no se ejecuta. Acciones sin `depends_on` se ejecutan siempre.
4. Si la operación requiere notificar al usuario:
   - El resultado se envía por WebSocket si la conexión está activa. TTS no está integrado en el flujo de producción actual; la respuesta se envía como texto.
   - Si TTS falla (cuando esté integrado), se envía texto sin audio como fallback.
   - Si no hay conexión activa, se envía notificación push (FCM).
   - Ambos canales pueden usarse simultáneamente para mensajes críticos (recordatorios).

### Notificaciones proactivas

El backend dispara notificaciones push (FCM) para:

- Recordar compromisos y plazos.
- Informar de replanificaciones significativas.

Los recordatorios programados se almacenan como jobs con `source: 'scheduled'` en la tabla `jobs`, con `run_at` configurado al momento del recordatorio.

## Quick Memory (Cache en RAM)

La Quick Memory es un cache en memoria del proceso que la vía rápida consulta para responder preguntas sin depender de la vía lenta. La actualiza la vía lenta mediante la acción `update_quick_memory`.

### Estructura

```typescript
interface QuickMemoryData {
	whoAmI: string;             // "Quién soy yo" auto-inferido de memorias
	topData: {                  // Data más utilizada
		tasks: string[];        // Top 5 tareas (por prioridad + vencimiento)
		objectives: string[];   // Top 3 objetivos activos
		lists: string[];        // Top 2 listas activas
		events: string[];       // Top 5 eventos próximos (7 días)
	};
	todayContext: {             // Data que se está usando hoy
		dueToday: string[];     // Tareas/eventos que vencen hoy
		inProgress: string[];   // Tareas en progreso
		recentMentions: string; // Última interacción significativa
	};
	recentTopics: string;       // Resumen temático de últimas consultas
	updatedAt: Date;
}
```

### Formato para el prompt de la vía rápida

`formatForPrompt()` genera un string < 700 tokens (~2800 chars) con 4 secciones opcionales:

1. **Quién soy**: identidad inferida de memorias con `interaction_type: preference_declaration`.
2. **Data clave**: tareas (prioridad + vencimiento), objetivos, listas, eventos próximos.
3. **Hoy**: tareas/eventos que vencen hoy, en progreso, mención reciente.
4. **Temas recientes**: palabras clave extraídas de memorias recientes (frecuencia léxica).

### Truncamiento

Si el string excede 2800 chars, se descartan secciones en orden de prioridad:
1. Temas recientes (primero)
2. Hoy (segundo)
3. Data clave y Quién soy (siempre preservados)

### Actualización

- La vía lenta genera la acción `update_quick_memory` cuando detecta que el contexto cambió significativamente (después de crear/modificar/eliminar datos).
- El handler consulta BD en paralelo (tareas, objetivos, listas, eventos, memorias) y reconstruye las 4 secciones.
- **whoAmI** se auto-infere de memorias con `interaction_type: preference_declaration`.
- **recentTopics** extrae keywords por frecuencia léxica de las últimas 3 memorias.
- No se actualiza automáticamente en cada job — solo cuando la vía lenta lo decide.

### Ubicación del código

- `backend/src/domain/quick-memory.ts` — singleton, get/update/formatForPrompt
- `backend/src/workers/action-handlers.ts` — `handleUpdateQuickMemory()`
- `backend/src/api/ws.ts` — inyección en `getFastResponse()`
- `backend/src/llm/prompts/fast-lane-system.ts` — prompt con instrucciones para usar el contexto

## Job Queue (PostgreSQL)

Tabla `jobs` para la cola de la vía lenta:

| Campo            | Tipo                              | Descripción                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------------- |
| `id`             | UUID (PK)                         | Identificador único del job                                   |
| `correlation_id` | UUID NOT NULL                     | ID del mensaje WebSocket original (trazabilidad end-to-end)   |
| `session_id`     | UUID NOT NULL                     | ID de la sesión WebSocket para enviar el resultado al cliente |
| `type`           | TEXT NOT NULL                     | Tipo de acción (ej: `process_message`)                        |
| `source`         | TEXT NOT NULL DEFAULT 'websocket' | Origen del job: `websocket`, `scheduled`, `system`            |
| `payload`        | JSONB NOT NULL                    | Datos del mensaje transcrito (ver esquema abajo)              |
| `status`         | TEXT NOT NULL                     | `pending`, `processing`, `completed`, `failed`                |
| `attempts`       | INTEGER DEFAULT 0                 | Número de intentos de procesamiento                           |
| `max_attempts`   | INTEGER DEFAULT 3                 | Máximo de reintentos antes de marcar como `failed`            |
| `run_at`         | TIMESTAMPTZ DEFAULT NOW()         | Momento en que el job está disponible para procesar           |
| `locked_at`      | TIMESTAMPTZ NULLABLE              | Momento en que el worker tomó el job                          |
| `locked_by`      | TEXT NULLABLE                     | Identificador del worker que procesa el job                   |
| `result`         | JSONB NULLABLE                    | Resultado del procesamiento (éxito o error)                   |
| `created_at`     | TIMESTAMPTZ DEFAULT NOW()         | Fecha de creación                                             |
| `updated_at`     | TIMESTAMPTZ DEFAULT NOW()         | Fecha de última actualización                                 |

**Origen de jobs** (`source`):

- `websocket`: mensaje del usuario recibido por WebSocket.
- `scheduled`: recordatorios automáticos y tareas programadas.
- `system`: tareas de mantenimiento como consolidación de memorias.

**Esquema del campo `payload`**:

El JSONB `payload` contiene los datos necesarios para que el worker procese el mensaje. Campos mínimos:

| Campo              | Tipo   | Requerido | Descripción                                        |
| ------------------ | ------ | --------- | -------------------------------------------------- |
| `transcribed_text` | string | Sí        | Texto transcrito por Whisper API                   |
| `audio_format`     | string | No        | Formato de audio negociado en auth (`mp3` o `pcm`) |
| `received_at`      | string | No        | Timestamp ISO 8601 de recepción del mensaje        |

Nota: `session_id` y `correlation_id` se almacenan como columnas de primer nivel (no dentro de `payload`) para permitir indexado y queries directos.

Ejemplo:

```json
{
	"transcribed_text": "Creá una tarea para revisar el presupuesto",
	"audio_format": "mp3",
	"received_at": "2026-05-19T14:30:00Z"
}
```

**Mecanismo de lock**: los workers consumen jobs con `SELECT ... FOR UPDATE SKIP LOCKED WHERE status = 'pending' AND run_at <= NOW()`. Esto evita que dos workers procesen el mismo job simultáneamente.

**Índices recomendados**: `(status, run_at)`, `(locked_by)`, `(correlation_id)`, `(session_id)`.

### Recovery de jobs huérfanos

Si un worker muere mientras procesa un job, ese job queda en estado `processing` con `locked_at` sin liberar. Para recuperar estos jobs:

- **Regla**: si `locked_at` tiene más de `JOB_ORPHAN_TIMEOUT_MS` milisegundos (default: 10 min), el job se considera huérfano y puede ser reclamado.
- **Worker de cleanup**: se ejecuta cada 5 minutos y ejecuta:
  ```sql
  UPDATE jobs
  SET status = 'pending', locked_at = NULL, locked_by = NULL
  WHERE status = 'processing'
    AND locked_at < NOW() - INTERVAL '10 minutes';
  ```
- **Configuración**: el timeout es ajustable via la variable de entorno `JOB_ORPHAN_TIMEOUT_MS` (default: 600000 = 10 min).

### Arquitectura del worker en Fase 1

En Fase 1, el worker corre en el mismo proceso Fastify como un polling interval (`setInterval`). Esto simplifica el despliegue y evita la complejidad de coordinación entre procesos. Escalar a un proceso separado (o múltiples workers) requiere actualizar este archivo.

## Acciones de la vía lenta

La vía lenta produce JSON estructurado que el worker ejecuta como operaciones CRUD. GPT‑5-mini devuelve un array de una o más acciones por mensaje procesado. El worker las ejecuta secuencialmente y envía un `action_result` por cada una al cliente.

### Tipos de acción

| Tipo                     | Descripción                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `create_task`            | Crear una nueva tarea                                                                                                                    |
| `start_task`             | Iniciar una tarea (cambiar a `in_progress`)                                                                                              |
| `update_task`            | Actualizar campos de una tarea existente                                                                                                 |
| `complete_task`          | Marcar tarea como completada                                                                                                             |
| `cancel_task`            | Cancelar una tarea (soft delete)                                                                                                         |
| `postpone_task`          | Posponer una tarea a otra fecha/hora (cambia estado a `postponed`)                                                                       |
| `create_objective`       | Crear un nuevo objetivo                                                                                                                  |
| `update_objective`       | Actualizar campos de un objetivo existente                                                                                               |
| `complete_objective`     | Marcar objetivo como completado (valida que no haya tareas pendientes)                                                                   |
| `cancel_objective`       | Cancelar un objetivo y sus tareas pendientes (cascada)                                                                                   |
| `pause_objective`        | Poner un objetivo en pausa                                                                                                               |
| `resume_objective`       | Reactivar un objetivo en pausa                                                                                                           |
| `store_memory`           | Almacenar una interacción significativa en memoria (texto + embedding)                                                                   |
| `respond`                | Responder al usuario con texto natural usando información del contexto (tareas, listas, objetivos)                                       |
| `query_list`             | Consultar el contenido de una lista existente (búsqueda por nombre). Si no se proporciona `list_title`, retorna todas las listas activas |
| `create_list`            | Crear una nueva lista (compra, ingredientes, etc.)                                                                                       |
| `add_list_items`         | Agregar items a una lista existente                                                                                                      |
| `check_list_item`        | Marcar un item de lista como completado                                                                                                  |
| `uncheck_list_item`      | Desmarcar un item de lista                                                                                                               |
| `complete_list`          | Marcar lista como completada (todos los items checked)                                                                                   |
| `cancel_list`            | Cancelar una lista (soft delete)                                                                                                         |
| `create_event`           | Crear un nuevo evento (único o recurrente)                                                                                               |
| `update_event`           | Actualizar campos de un evento existente                                                                                                 |
| `delete_event`           | Cancelar un evento (soft delete)                                                                                                         |
| `query_events`           | Consultar eventos en un rango de fechas                                                                                                  |
| `move_event_instance`    | Mover una instancia específica de evento recurrente (crea excepción)                                                                     |
| `update_recurrence_rule` | Modificar la regla de recurrencia de un evento recurrente                                                                                |
| `link_task_event`        | Vincular tareas con eventos (relación muchos-a-muchos)                                                                                   |
| `unlink_task_event`      | Desvincular tareas de eventos                                                                                                            |

### Estructura general de acciones

Todas las acciones siguen este formato base:

```json
{
  "action": "nombre_de_la_accion",
  "payload": { ... },
  "depends_on": 0  // opcional: índice 0-based de la acción de la que depende
}
```

El campo `depends_on` es opcional. Cuando está presente, el worker solo ejecuta esta acción si la acción referenciada se completó exitosamente. Si la acción referenciada falló, esta recibe error `PREVIOUS_ACTION_FAILED`. Acciones sin `depends_on` se ejecutan siempre, independientemente de fallos anteriores.

### Esquema detallado por acción

#### `create_task`

| Campo          | Tipo   | Requerido | Descripción                                                                     |
| -------------- | ------ | --------- | ------------------------------------------------------------------------------- |
| `title`        | string | Sí        | Título breve de la tarea                                                        |
| `description`  | string | No        | Descripción detallada                                                           |
| `due_date`     | string | No        | Fecha límite en ISO 8601                                                        |
| `objective_id` | string | No        | UUID del objetivo al que pertenece                                              |
| `priority`     | string | No        | Prioridad: `low`, `medium`, `high`. Si no se provee, el dominio asigna `medium` |
| `context`      | object | No        | Metadata estructurada (ubicación, hora del día, dispositivo, etc.)              |

Ejemplo:

```json
{
	"action": "create_task",
	"payload": {
		"title": "Revisar presupuesto mensual",
		"description": "Comparar gastos reales vs. presupuestados de abril",
		"due_date": "2026-05-25T23:59:59Z",
		"objective_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"priority": "high",
		"context": {
			"location": "auto",
			"time_of_day": "mañana",
			"device": "mobile"
		}
	}
}
```

#### `start_task`

| Campo     | Tipo   | Requerido | Descripción                |
| --------- | ------ | --------- | -------------------------- |
| `task_id` | string | Sí        | UUID de la tarea a iniciar |

Transición: `pending` → `in_progress` o `postponed` → `in_progress`.

Ejemplo:

```json
{
	"action": "start_task",
	"payload": {
		"task_id": "f0e1d2c3-b4a5-6789-0abc-def123456789"
	}
}
```

#### `update_task`

| Campo          | Tipo   | Requerido | Descripción                               |
| -------------- | ------ | --------- | ----------------------------------------- |
| `task_id`      | string | Sí        | UUID de la tarea a actualizar             |
| `title`        | string | No        | Nuevo título                              |
| `description`  | string | No        | Nueva descripción                         |
| `due_date`     | string | No        | Nueva fecha límite (ISO 8601)             |
| `objective_id` | string | No        | Nuevo objetivo asociado                   |
| `priority`     | string | No        | Nueva prioridad (`low`, `medium`, `high`) |
| `context`      | object | No        | Nuevo contexto (JSONB)                    |

Ejemplo:

```json
{
	"action": "update_task",
	"payload": {
		"task_id": "f0e1d2c3-b4a5-6789-0abc-def123456789",
		"due_date": "2026-05-30T23:59:59Z"
	}
}
```

#### `complete_task`

| Campo     | Tipo   | Requerido | Descripción                  |
| --------- | ------ | --------- | ---------------------------- |
| `task_id` | string | Sí        | UUID de la tarea a completar |

Ejemplo:

```json
{
	"action": "complete_task",
	"payload": {
		"task_id": "f0e1d2c3-b4a5-6789-0abc-def123456789"
	}
}
```

#### `cancel_task`

| Campo     | Tipo   | Requerido | Descripción                 |
| --------- | ------ | --------- | --------------------------- |
| `task_id` | string | Sí        | UUID de la tarea a cancelar |

Ejemplo:

```json
{
	"action": "cancel_task",
	"payload": {
		"task_id": "f0e1d2c3-b4a5-6789-0abc-def123456789"
	}
}
```

#### `postpone_task`

| Campo      | Tipo   | Requerido | Descripción                   |
| ---------- | ------ | --------- | ----------------------------- |
| `task_id`  | string | Sí        | UUID de la tarea a posponer   |
| `due_date` | string | Sí        | Nueva fecha límite (ISO 8601) |

Esta acción también transiciona el estado de la tarea a `postponed`.

Ejemplo:

```json
{
	"action": "postpone_task",
	"payload": {
		"task_id": "f0e1d2c3-b4a5-6789-0abc-def123456789",
		"due_date": "2026-06-01T23:59:59Z"
	}
}
```

#### `create_objective`

| Campo         | Tipo   | Requerido | Descripción                           |
| ------------- | ------ | --------- | ------------------------------------- |
| `title`       | string | Sí        | Título breve del objetivo             |
| `description` | string | No        | Descripción detallada                 |
| `deadline`    | string | No        | Fecha límite del objetivo en ISO 8601 |

Ejemplo:

```json
{
	"action": "create_objective",
	"payload": {
		"title": "Ahorrar $5000 para vacaciones",
		"description": "Reducir gastos hormiga y depositar $1000/mes",
		"deadline": "2026-12-31T23:59:59Z"
	}
}
```

#### `update_objective`

| Campo          | Tipo   | Requerido | Descripción                    |
| -------------- | ------ | --------- | ------------------------------ |
| `objective_id` | string | Sí        | UUID del objetivo a actualizar |
| `title`        | string | No        | Nuevo título                   |
| `description`  | string | No        | Nueva descripción              |
| `deadline`     | string | No        | Nueva fecha límite (ISO 8601)  |

Ejemplo:

```json
{
	"action": "update_objective",
	"payload": {
		"objective_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"deadline": "2027-03-31T23:59:59Z"
	}
}
```

#### `complete_objective`

| Campo          | Tipo   | Requerido | Descripción                   |
| -------------- | ------ | --------- | ----------------------------- |
| `objective_id` | string | Sí        | UUID del objetivo a completar |

Validación: no debe tener tareas en estado `pending` o `in_progress`.

Ejemplo:

```json
{
	"action": "complete_objective",
	"payload": {
		"objective_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `cancel_objective`

| Campo          | Tipo   | Requerido | Descripción                  |
| -------------- | ------ | --------- | ---------------------------- |
| `objective_id` | string | Sí        | UUID del objetivo a cancelar |

Efecto cascada: todas las tareas en `pending`, `in_progress` o `postponed` pasan a `cancelled`.

Ejemplo:

```json
{
	"action": "cancel_objective",
	"payload": {
		"objective_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `pause_objective`

| Campo          | Tipo   | Requerido | Descripción                |
| -------------- | ------ | --------- | -------------------------- |
| `objective_id` | string | Sí        | UUID del objetivo a pausar |

Ejemplo:

```json
{
	"action": "pause_objective",
	"payload": {
		"objective_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `resume_objective`

| Campo          | Tipo   | Requerido | Descripción                   |
| -------------- | ------ | --------- | ----------------------------- |
| `objective_id` | string | Sí        | UUID del objetivo a reactivar |

Ejemplo:

```json
{
	"action": "resume_objective",
	"payload": {
		"objective_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `store_memory`

| Campo      | Tipo   | Requerido | Descripción                                                      |
| ---------- | ------ | --------- | ---------------------------------------------------------------- |
| `content`  | string | Sí        | Texto resumido de la interacción significativa                   |
| `metadata` | object | No        | Tipo de interacción, entidades referenciadas, contexto adicional |

Ejemplo:

```json
{
	"action": "store_memory",
	"payload": {
		"content": "El usuario prefiere hacer tareas administrativas los martes por la mañana",
		"metadata": {
			"interaction_type": "preference_declaration",
			"entities": ["tasks", "scheduling"],
			"context": "mencionado casualmente durante revisión de agenda"
		}
	}
}
```

**Flujo de embeddings**: cuando la vía lenta produce una acción `store_memory`, el worker:

1. Genera el embedding del campo `content` usando `text-embedding-3-small`.
2. Inserta en la tabla `memories` con `content` + `embedding` + `metadata`.

#### `create_list`

| Campo         | Tipo   | Requerido | Descripción                                                                  |
| ------------- | ------ | --------- | ---------------------------------------------------------------------------- |
| `title`       | string | Sí        | Título breve de la lista                                                     |
| `type`        | string | No        | Tipo flexible: `shopping`, `ingredients`, `general`, etc. Default: `general` |
| `description` | string | No        | Descripción detallada                                                        |
| `items`       | array  | No        | Array opcional de `{ content, quantity? }`                                   |

Ejemplo:

```json
{
	"action": "create_list",
	"payload": {
		"title": "Lista del supermercado",
		"type": "shopping",
		"items": [
			{ "content": "Tomates", "quantity": "2 kg" },
			{ "content": "Lechuga", "quantity": "1 unidad" }
		]
	}
}
```

#### `add_list_items`

| Campo     | Tipo   | Requerido | Descripción                                       |
| --------- | ------ | --------- | ------------------------------------------------- |
| `list_id` | string | Sí        | UUID de la lista                                  |
| `items`   | array  | Sí        | Array de `{ content: string, quantity?: string }` |

Ejemplo:

```json
{
	"action": "add_list_items",
	"payload": {
		"list_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"items": [{ "content": "Pan", "quantity": "1 kg" }]
	}
}
```

#### `check_list_item`

| Campo        | Tipo   | Requerido | Descripción                      |
| ------------ | ------ | --------- | -------------------------------- |
| `list_id`    | string | Sí        | UUID de la lista                 |
| `item_index` | number | Sí        | Índice 0-based del item a marcar |

Ejemplo:

```json
{
	"action": "check_list_item",
	"payload": {
		"list_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"item_index": 0
	}
}
```

#### `uncheck_list_item`

| Campo        | Tipo   | Requerido | Descripción                         |
| ------------ | ------ | --------- | ----------------------------------- |
| `list_id`    | string | Sí        | UUID de la lista                    |
| `item_index` | number | Sí        | Índice 0-based del item a desmarcar |

Ejemplo:

```json
{
	"action": "uncheck_list_item",
	"payload": {
		"list_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"item_index": 1
	}
}
```

#### `complete_list`

| Campo     | Tipo   | Requerido | Descripción      |
| --------- | ------ | --------- | ---------------- |
| `list_id` | string | Sí        | UUID de la lista |

Validación: todos los items deben estar `checked` (o la lista debe estar vacía).

Ejemplo:

```json
{
	"action": "complete_list",
	"payload": {
		"list_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `cancel_list`

| Campo     | Tipo   | Requerido | Descripción      |
| --------- | ------ | --------- | ---------------- |
| `list_id` | string | Sí        | UUID de la lista |

Ejemplo:

```json
{
	"action": "cancel_list",
	"payload": {
		"list_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `create_event`

| Campo             | Tipo   | Requerido | Descripción                                    |
| ----------------- | ------ | --------- | ---------------------------------------------- |
| `title`           | string | Sí        | Título del evento                              |
| `start_time`      | string | Sí        | Fecha y hora de inicio (ISO 8601)              |
| `end_time`        | string | No        | Fecha y hora de fin (ISO 8601)                 |
| `description`     | string | No        | Descripción detallada                          |
| `location`        | string | No        | Ubicación del evento                           |
| `category`        | string | No        | Categoría (ej: `trabajo`, `personal`, `salud`) |
| `recurrence_rule` | object | No        | Regla de recurrencia (ver formato abajo)       |

**Formato de `recurrence_rule`**:

| Campo         | Tipo     | Requerido | Descripción                                                            |
| ------------- | -------- | --------- | ---------------------------------------------------------------------- |
| `frequency`   | string   | Sí        | `daily`, `weekly`, `monthly`, `yearly`                                 |
| `interval`    | number   | No        | Cada N unidades (default: 1)                                           |
| `daysOfWeek`  | number[] | No        | Días de la semana (0=domingo, 1=lunes... 6=sábado). Usado con `weekly` |
| `dayOfMonth`  | number   | No        | Día del mes (1-31). Usado con `monthly`                                |
| `monthOfYear` | number   | No        | Mes del año (1-12). Usado con `yearly`                                 |
| `endDate`     | string   | No        | Fecha de fin de recurrencia (ISO 8601)                                 |
| `count`       | number   | No        | Límite de ocurrencias                                                  |

Ejemplo (evento único):

```json
{
	"action": "create_event",
	"payload": {
		"title": "Reunión de equipo",
		"start_time": "2026-06-01T10:00:00Z",
		"end_time": "2026-06-01T11:00:00Z",
		"location": "Sala A",
		"category": "trabajo"
	}
}
```

Ejemplo (evento recurrente semanal):

```json
{
	"action": "create_event",
	"payload": {
		"title": "Daily standup",
		"start_time": "2026-06-01T09:00:00Z",
		"end_time": "2026-06-01T09:15:00Z",
		"recurrence_rule": {
			"frequency": "weekly",
			"interval": 1,
			"daysOfWeek": [1, 2, 3, 4, 5]
		}
	}
}
```

#### `update_event`

| Campo         | Tipo   | Requerido | Descripción                      |
| ------------- | ------ | --------- | -------------------------------- |
| `event_id`    | string | Sí        | UUID del evento a actualizar     |
| `title`       | string | No        | Nuevo título                     |
| `description` | string | No        | Nueva descripción                |
| `location`    | string | No        | Nueva ubicación                  |
| `category`    | string | No        | Nueva categoría                  |
| `start_time`  | string | No        | Nueva fecha de inicio (ISO 8601) |
| `end_time`    | string | No        | Nueva fecha de fin (ISO 8601)    |

Los campos no proporcionados no se modifican (patch semántico).

Ejemplo:

```json
{
	"action": "update_event",
	"payload": {
		"event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"start_time": "2026-06-02T14:00:00Z"
	}
}
```

#### `delete_event`

| Campo      | Tipo   | Requerido | Descripción                |
| ---------- | ------ | --------- | -------------------------- |
| `event_id` | string | Sí        | UUID del evento a cancelar |

Ejemplo:

```json
{
	"action": "delete_event",
	"payload": {
		"event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	}
}
```

#### `query_events`

| Campo        | Tipo   | Requerido | Descripción                                     |
| ------------ | ------ | --------- | ----------------------------------------------- |
| `start_date` | string | No        | Inicio del rango (ISO 8601). Default: hoy       |
| `end_date`   | string | No        | Fin del rango (ISO 8601). Default: hoy + 7 días |

Retorna eventos únicos + recurrentes + excepciones en el rango.

Ejemplo:

```json
{
	"action": "query_events",
	"payload": {
		"start_date": "2026-06-01T00:00:00Z",
		"end_date": "2026-06-07T23:59:59Z"
	}
}
```

#### `move_event_instance`

| Campo            | Tipo   | Requerido | Descripción                                                                      |
| ---------------- | ------ | --------- | -------------------------------------------------------------------------------- |
| `event_id`       | string | Sí        | UUID del evento (o evento padre recurrente)                                      |
| `new_start_time` | string | Sí        | Nueva fecha/hora (ISO 8601)                                                      |
| `new_end_time`   | string | No        | Nueva fecha/hora de fin (ISO 8601)                                               |
| `exception_date` | string | No        | Fecha original de la instancia a reemplazar (ISO 8601). Para eventos recurrentes |

Si el evento no es recurrente, simplemente lo actualiza. Si es recurrente, crea una excepción que reemplaza esa instancia específica sin afectar las demás.

Ejemplo:

```json
{
	"action": "move_event_instance",
	"payload": {
		"event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"new_start_time": "2026-06-04T11:00:00Z",
		"exception_date": "2026-06-03T10:00:00Z"
	}
}
```

#### `update_recurrence_rule`

| Campo             | Tipo   | Requerido | Descripción                                                      |
| ----------------- | ------ | --------- | ---------------------------------------------------------------- |
| `event_id`        | string | Sí        | UUID del evento recurrente                                       |
| `recurrence_rule` | object | Sí        | Nueva regla de recurrencia (mismo formato que en `create_event`) |

Ejemplo:

```json
{
	"action": "update_recurrence_rule",
	"payload": {
		"event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"recurrence_rule": {
			"frequency": "weekly",
			"interval": 1,
			"daysOfWeek": [1, 3, 5]
		}
	}
}
```

#### `link_task_event`

| Campo       | Tipo               | Requerido | Descripción                      |
| ----------- | ------------------ | --------- | -------------------------------- |
| `task_ids`  | string \| string[] | Sí        | UUID o array de UUIDs de tareas  |
| `event_ids` | string \| string[] | Sí        | UUID o array de UUIDs de eventos |

Establece una relación muchos-a-muchos: varias tareas pueden vincularse a varios eventos.

Ejemplo:

```json
{
	"action": "link_task_event",
	"payload": {
		"task_ids": ["t1-uuid", "t2-uuid"],
		"event_ids": ["ev1-uuid"]
	}
}
```

#### `unlink_task_event`

| Campo       | Tipo               | Requerido | Descripción                      |
| ----------- | ------------------ | --------- | -------------------------------- |
| `task_ids`  | string \| string[] | Sí        | UUID o array de UUIDs de tareas  |
| `event_ids` | string \| string[] | Sí        | UUID o array de UUIDs de eventos |

Ejemplo:

```json
{
	"action": "unlink_task_event",
	"payload": {
		"task_ids": ["t1-uuid"],
		"event_ids": ["ev1-uuid"]
	}
}
```

#### `respond`

| Campo  | Tipo   | Requerido | Descripción                                                              |
| ------ | ------ | --------- | ------------------------------------------------------------------------ |
| `text` | string | Sí        | Respuesta natural en español al usuario, usando información del contexto |

Responde al usuario con texto conversacional basado en la información disponible en el contexto (tareas activas, listas, objetivos, memorias). Se usa para preguntas, resúmenes, cruces de datos e insights. **No** debe usarse para almacenar información (para eso usar `store_memory`).

Ejemplo:

```json
{
	"action": "respond",
	"payload": {
		"text": "Tenés 3 tareas pendientes: revisar el presupuesto (alta), comprar leche (media) y llamar a tu mamá (baja). También tenés una lista del supermercado con 5 items."
	}
}
```

#### `query_list`

| Campo        | Tipo   | Requerido | Descripción                                                                                                      |
| ------------ | ------ | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `list_title` | string | No        | Nombre o parte del nombre de la lista (búsqueda case-insensitive). Si se omite, retorna todas las listas activas |

Consulta el contenido de una lista existente por nombre. La búsqueda es case-insensitive con partial match. Si hay múltiples coincidencias, retorna error `AMBIGUOUS_MATCH`.

Ejemplo:

```json
{
	"action": "query_list",
	"payload": {
		"list_title": "lista del supermercado"
	}
}
```

### Respuesta al cliente (`action_result`)

Cuando el worker completa una acción, envía un mensaje `action_result` al cliente usando discriminated union (`ok`):

Éxito:

```json
{
	"version": "1",
	"type": "action_result",
	"ok": true,
	"action": "create_task",
	"correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"payload": {
		"id": "f0e1d2c3-b4a5-6789-0abc-def123456789",
		"title": "Revisar presupuesto mensual",
		"status": "pending",
		"due_date": "2026-05-25T23:59:59Z"
	}
}
```

Error:

```json
{
	"version": "1",
	"type": "action_result",
	"ok": false,
	"action": "complete_objective",
	"correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"payload": {
		"error": "OBJECTIVE_HAS_PENDING_TASKS",
		"message": "El objetivo tiene tareas pendientes que deben completarse o cancelarse primero"
	}
}
```

Códigos de error de acción:

| Código                        | Descripción                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `TASK_NOT_FOUND`              | No existe una tarea con el ID proporcionado                                     |
| `OBJECTIVE_NOT_FOUND`         | No existe un objetivo con el ID proporcionado                                   |
| `INVALID_STATE_TRANSITION`    | La transición de estado no está permitida por la máquina de estados             |
| `OBJECTIVE_HAS_PENDING_TASKS` | El objetivo tiene tareas pendientes (bloquea completar objetivo)                |
| `LIST_NOT_FOUND`              | No existe una lista con el nombre o ID proporcionado                            |
| `AMBIGUOUS_MATCH`             | Múltiples listas coinciden con el nombre buscado (ser más específico)           |
| `LIST_HAS_UNCHECKED_ITEMS`    | La lista tiene items sin completar (bloquea completar lista)                    |
| `INVALID_ITEM_INDEX`          | El índice de item está fuera del rango del array                                |
| `MISSING_REQUIRED_FIELD`      | Falta un campo requerido en el payload                                          |
| `PREVIOUS_ACTION_FAILED`      | Una acción con `depends_on` referencia una acción que falló; esta no se ejecutó |
| `EVENT_NOT_FOUND`             | No existe un evento con el ID proporcionado                                     |
| `INVALID_RECURRENCE_RULE`     | La regla de recurrencia tiene un formato inválido                               |
| `EXCEPTION_DATE_MISMATCH`     | La fecha de excepción no coincide con ninguna instancia recurrente              |

### Reglas de la vía lenta

1. La vía lenta produce **una o más acciones** por mensaje procesado. gpt-5-mini devuelve un array de acciones en `{ "actions": [...] }`.
2. El worker ejecuta las acciones secuencialmente. Cada acción se ejecuta independientemente a menos que tenga el campo `depends_on` especificado. Si `depends_on` referencia una acción que falló, esa acción recibe `PREVIOUS_ACTION_FAILED` y no se ejecuta. Acciones sin `depends_on` se ejecutan siempre.
3. Si el mensaje del usuario es ambiguo, la vía lenta debe elegir la acción más probable y notificar al usuario.
4. Si el mensaje no mapea a ninguna acción, la vía lenta envía `store_memory` para preservar la interacción.
5. Cuando el usuario pregunta por información existente (tareas, listas, objetivos, eventos, resúmenes, cruces de datos), la vía lenta debe usar `respond` en vez de `store_memory`. `respond` genera texto conversacional usando el contexto disponible sin tocar la base de datos.
6. Los campos no proporcionados en `update_task`, `update_objective` y `update_event` no se modifican (patch semántico, no replace). En listas, `add_list_items` siempre agrega al array existente; no reemplaza.

## Data model & business rules

### Entidades clave

- **tasks**: unidad atómica de acción. Campos: `id` (UUID PK), `title`, `description`, `status` (enum: `pending`, `in_progress`, `completed`, `postponed`, `cancelled`), `due_date` (timestamptz nullable), `priority` (enum: `low`, `medium`, `high`), `objective_id` (UUID FK nullable), `context` (JSONB), `created_at` (timestamptz), `updated_at` (timestamptz), `cancelled_at` (timestamptz nullable).
- **objectives**: meta a corto/mediano/largo plazo. Campos: `id` (UUID PK), `title`, `description`, `deadline` (timestamptz nullable), `status` (enum: `active`, `paused`, `completed`, `cancelled`), `created_at` (timestamptz), `updated_at` (timestamptz), `cancelled_at` (timestamptz nullable).
- **memories**: interacción significativa almacenada como texto + embedding. Campos: `id` (UUID PK), `content` (texto resumido), `embedding` (vector 1536 dim), `metadata` (JSONB: tipo de interacción, entidades referenciadas), `created_at` (timestamptz), `updated_at` (timestamptz).
- **conversation_turns**: registro de cada intercambio en una sesión. Campos: `id` (UUID PK), `session_id` (UUID), `role` (enum: `user`, `assistant`, `system`), `content` (texto), `created_at` (timestamptz). `user` = mensaje del usuario, `assistant` = respuesta de la vía rápida o resultado de la vía lenta, `system` = mensajes del sistema (confirmaciones automáticas, errores). La vía lenta consulta los últimos N turns de la sesión actual como contexto para gpt-5-mini. **Índices recomendados**: `(session_id, created_at DESC)` para consultas de contexto conversacional.
- **lists**: colección flexible de items (compra, ingredientes, etc.). Campos: `id` (UUID PK), `title`, `description`, `type` (string libre: `shopping`, `ingredients`, `general`, etc.), `status` (enum: `active`, `completed`, `cancelled`), `items` (JSONB: array de `{ content, quantity?, checked }`), `created_at` (timestamptz), `updated_at` (timestamptz), `cancelled_at` (timestamptz nullable).
- **events**: evento único o recurrente con soporte de excepciones. Campos: `id` (UUID PK), `title`, `description`, `location`, `category`, `start_time` (timestamptz), `end_time` (timestamptz nullable), `status` (enum: `active`, `completed`, `cancelled`), `recurrence_rule` (JSONB nullable — patrón de recurrencia), `parent_id` (UUID FK nullable — para excepciones de eventos recurrentes), `is_exception` (boolean), `exception_date` (timestamptz nullable — fecha original que esta excepción reemplaza), `cancelled_at` (timestamptz nullable).
- **task_event_links**: join table many-to-many entre tasks y events. Campos: `id` (UUID PK), `task_id` (UUID FK), `event_id` (UUID FK). Unique constraint `(task_id, event_id)`.

### Relaciones entre entidades

- Una tarea pertenece a un objetivo (`objective_id` → `objectives.id`).
- Un objetivo tiene muchas tareas.
- Una tarea puede estar vinculada a muchos eventos, y un evento puede estar vinculado a muchas tareas (relación muchos-a-muchos via `task_event_links`).
- Un evento recurrente puede tener muchas excepciones (self-reference via `parent_id`).
- Soft delete en tasks, objectives, events y lists: estado `cancelled` con timestamp en `cancelled_at`. `memories` y `conversation_turns` no tienen soft delete.
- Los `conversation_turns` pertenecen a una sesión WebSocket identificada por `session_id`.

### Convención de migraciones Prisma

- Naming de migraciones: `YYYYMMDDHHMMSS_descriptive_name` (Prisma lo genera automáticamente con `prisma migrate dev`).
- Incluir seeds para datos iniciales: estados de tarea como enum, estados de objetivo.
- Archivos seed en `backend/prisma/seed.ts`.

### Maquina de estados de tareas

```
pending ──► in_progress ──► completed
    │            │                │
    │            │         (irreversible)
    │            │
    ├──► postponed ──► pending
    │        │
    │        └──► in_progress
    │
    └──► cancelled (desde cualquier estado excepto completed y cancelled)
```

- `pending`: recién creada, sin iniciar.
- `in_progress`: el usuario la está trabajando.
- `completed`: terminada exitosamente. **Irreversible**: no se puede reabrir ni cancelar.
- `postponed`: movida a otra fecha/hora.
- `cancelled`: eliminada lógicamente. **Irreversible**: no se puede reabrir. Se registra `cancelled_at`.

Transiciones permitidas:

| Desde       | Hacia       | Condiciones     |
| ----------- | ----------- | --------------- |
| pending     | in_progress | Sin restricción |
| pending     | postponed   | Sin restricción |
| pending     | cancelled   | Sin restricción |
| in_progress | completed   | Sin restricción |
| in_progress | postponed   | Sin restricción |
| in_progress | cancelled   | Sin restricción |
| postponed   | pending     | Sin restricción |
| postponed   | in_progress | Sin restricción |
| postponed   | cancelled   | Sin restricción |

### Máquina de estados de objetivos

```
active ──► paused ──► active
  │          │
  │          └──► cancelled
  │
  ├──► completed (irreversible)
  │
  └──► cancelled
```

- `active`: en progreso, tiene tareas pendientes o en curso.
- `paused`: temporariamente detenido. Las tareas asociadas pueden seguir existiendo pero no se asignan nuevas.
- `completed`: todas las tareas relevantes finalizadas. **Irreversible**.
- `cancelled`: eliminado lógicamente. **Irreversible**. Se registra `cancelled_at`.

Transiciones permitidas:

| Desde  | Hacia     | Condiciones                                                                                            |
| ------ | --------- | ------------------------------------------------------------------------------------------------------ |
| active | paused    | Sin restricción                                                                                        |
| active | completed | No debe tener tareas en estado `pending` o `in_progress` (todas deben estar `completed` o `cancelled`) |
| active | cancelled | Sin restricción                                                                                        |
| paused | active    | Sin restricción                                                                                        |
| paused | cancelled | Sin restricción                                                                                        |

**Efecto cascada**: al cancelar un objetivo, todas sus tareas asociadas en estado `pending`, `in_progress` o `postponed` pasan a `cancelled`. Las tareas `completed` se mantienen como están.

### Máquina de estados de listas

```
active ──► completed (irreversible)
  │
  └──► cancelled (irreversible)
```

- `active`: lista en uso, se pueden agregar/modificar items.
- `completed`: todos los items están marcados como `checked`. **Irreversible**.
- `cancelled`: lista descartada. **Irreversible**. Se registra `cancelled_at`.

Transiciones permitidas:

| Desde  | Hacia     | Condiciones                           |
| ------ | --------- | ------------------------------------- |
| active | completed | Todos los items deben estar `checked` |
| active | cancelled | Sin restricción                       |

### Máquina de estados de eventos

```
active ──► completed (irreversible)
  │
  └──► cancelled (irreversible)
```

- `active`: evento en curso, se puede modificar.
- `completed`: evento finalizado. **Irreversible**.
- `cancelled`: evento cancelado. **Irreversible**. Se registra `cancelled_at`.

Transiciones permitidas:

| Desde  | Hacia     | Condiciones     |
| ------ | --------- | --------------- |
| active | completed | Sin restricción |
| active | cancelled | Sin restricción |

### Personalidad del clon

El sistema no tiene una personalidad fija predeterminada. Replica la personalidad del usuario: su tono, sus valores, su forma de hablar. La personalidad se infiere automáticamente a partir de las interacciones, decisiones previas y objetivos declarados.

**Invariantes**:

- El sistema **no** es un to‑do list complaciente. La mayoría de los asistentes de IA tienden a validar todo; este sistema no.
- La personalidad se construye progresivamente a partir de: decisiones previas del usuario, objetivos declarados, y patrón de comunicación observado.

### Memoria a largo plazo (RAG con pgvector)

- Cada interacción significativa del usuario se almacena como texto resumido + embedding vectorial (no el transcript completo).
- **Criterio de almacenamiento**: la vía lenta marca una interacción como significativa cuando implica una decisión del usuario o una declaración de preferencia.
- Cuando la vía lenta procesa un mensaje, consulta los top-K memorias más relevantes por similitud semántica para dar contexto a gpt-5-mini. K es configurable via `MEMORY_RETRIEVAL_LIMIT` (default: 5).
- La vía lenta también consulta los últimos N `conversation_turns` de la sesión actual como contexto conversacional (N es configurable via `CONVERSATION_TURNS_LIMIT`, default: 10).
- Los embeddings se generan con `text-embedding-3-small`.
- **Configuración pgvector**:
  - Dimensión: 1536 (correspondiente a `text-embedding-3-small`).
  - Índice: HNSW con `m = 16`, `ef_construction = 64`.
  - Métrica de distancia: cosine (`vector_cosine_ops`).
  - Operador de búsqueda: `<=>` (cosine distance) para nearest-neighbor queries.
  - SQL de creación: `CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);`
- La memoria permite recordar preferencias, historial de decisiones y contexto de objetivos a largo plazo.
- Esta memoria alimenta la personalidad del clon: el sistema aprende cómo habla y qué valora el usuario a partir de lo almacenado.
- **Política de retención**: las memorias no se eliminan automáticamente. Se consolida periódicamente (Fase 2) resumiendo memorias similares en una sola entrada con embedding actualizado.

## Project structure

Estructura **definida** del proyecto:

```
backend/
  src/
    api/            # Controladores HTTP/WebSocket (Fastify)
    workers/        # Workers de cola (vía lenta)
    llm/            # Integraciones: OpenAI (Whisper, gpt-5-nano, gpt-5-mini, embeddings); prompts
    db/             # Cliente PostgreSQL, schema Prisma, repositorios
    domain/         # Reglas de negocio: tareas, objetivos, listas, notificaciones
    config/         # Configuración (variables de entorno, límites, flags)
    auth/           # Autenticación por token estático
  prisma/
    schema.prisma   # Modelos de base de datos
    seed.ts         # Datos iniciales (estados, categorías)
appmovil/           # App Flutter (cliente de voz)
```

No mover carpetas de alto nivel sin instrucción explícita.

## Code conventions

- **Naming**: `camelCase` en TypeScript, `snake_case` en BD, archivos en `kebab-case.ts`. Modelos Prisma en `PascalCase` en inglés (`Task`, `Objective`, `Memory`, `ConversationTurn`). Tablas BD en `snake_case` en inglés (`tasks`, `objectives`, `memories`, `conversation_turns`). Si se necesita otro nombre de tabla, usar `@@map` en el schema Prisma.
- **Imports**: agrupar en tres bloques: (1) externos, (2) internos absolutos (`@/...`), (3) relativos. Separar con línea en blanco.
- **Error handling**: usar patrón `Result<T, E>` en `domain/`. Evitar try/catch disperso. Las funciones que pueden fallar devuelven `Result`; los controladores de api/workers manejan el desempaquetado. Definición canónica:
  ```typescript
  type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
  ```
  Helpers: `ok(value)` y `err(error)` para construcción. Error types como enums por dominio (ej.: `TaskError`, `ObjectiveError`).
- **Tipos**: preferir discriminated unions para tipos con variantes. Nunca `any`, `as unknown as T`, non-null assertion `!`, ni `@ts-ignore`. Usar type guards y narrowing explícito.
- **Exports**: un export default por archivo solo si el archivo define una entidad principal. Lo demás: named exports.
- **Testing**: un archivo de test por cada archivo de producción, en el mismo directorio, con sufijo `.test.ts`.

## Logging

- **Librería**: pino (integrado con Fastify).
- **Formato**: structured JSON en producción, pretty-print en desarrollo.
- **Niveles**:
  - `fatal`: error que detiene el servidor.
  - `error`: excepciones no recuperables (fallo de BD, timeout de integración).
  - `warn`: situaciones recuperables pero inusuales (retry de worker).
  - `info`: inicio/fin de requests, conexiones WebSocket, jobs procesados. Incluye `correlation_id` cuando esté disponible.
  - `debug`: detalles de flujo interno, solo en desarrollo.
  - `trace`: contenido de mensajes STT/TTS, solo en desarrollo y nunca en producción.
- **Regla**: los logs nunca contienen secretos, tokens, transcripciones completas, ni embeddings.

## AI integrations

### OpenAI Whisper API (STT)

- Modelo: `whisper-1`.
- STT **solo transcribe**. No mezclar concerns de STT con lógica de negocio.
- Utilizado en el flujo de vía rápida: `audio_chunks` → Whisper → texto.

### OpenAI LLM vía rápida (Fast Lane)

- Modelo configurable via `OPENAI_FAST_MODEL` (default: `gpt-5-nano`, compatible con GPT-5 y modelos que usen `max_completion_tokens`).
- Genera respuestas textuales rápidas usando el system prompt de vía rápida.
- **Nunca** escribe en base de datos directamente (solo `conversation_turns` y encolado de vía lenta).
- Timeout configurable via `FAST_LANE_TIMEOUT_MS` (default: 5000 ms). Si expira, se envía respuesta genérica y la vía lenta procesa el mensaje.
- Usa `max_completion_tokens` en vez de `max_tokens` para compatibilidad con modelos que no soportan `max_tokens` (ej: GPT-5).

### OpenAI LLM vía lenta (Slow Lane)

- Modelo configurable via `OPENAI_SLOW_MODEL` (default: `gpt-5-mini`, compatible con GPT-5 y modelos que usen `max_completion_tokens`).
- Usa `max_completion_tokens` en vez de `max_tokens` para compatibilidad con modelos GPT-5.
- Extraer JSON/estructuras fuertemente tipadas.
- Validar reglas y detectar conflictos.
- Decidir operaciones CRUD sobre la base de datos.
- Recibe contexto: últimos N `conversation_turns` de la sesión + top-K memorias relevantes + objetivos activos + tareas activas.

### OpenAI TTS (text-to-speech) — no integrado en producción

- Modelo: `tts-1-hd` (voz `nova`).
- Función `synthesizeText` existe en `llm/tts.ts` pero **no se utiliza** en ningún flujo de producción actual (no se importa desde `ws.ts` ni el worker).
- Pendiente de integración futura.

### OpenAI text-embedding-3-small (embeddings)

- Dimensión: 1536.
- Usado para RAG con pgvector en memorias a largo plazo.

### Estructura de prompts

- **Ubicación**: `backend/src/llm/prompts/`.
- **Archivos**: `fast-lane-system.ts` (vía rápida), `slow-lane-system.ts`, `slow-lane-actions.ts` (vía lenta).
- **Variables de template**: `{{user_context}}`, `{{recent_memories}}`, `{{active_objectives}}`, `{{active_tasks}}`, `{{active_lists}}`, `{{conversation_turns}}`. `{{active_tasks}}` incluye las tareas en estado `pending`, `in_progress` y `postponed` de los objetivos activos (y tareas sin objetivo), necesarias para que gpt-5-mini resuelva referencias como "marcar la tarea de presupuesto como completada". `{{active_lists}}` incluye las listas en estado `active`.
- **Regla**: los prompts **siempre** viven en código versionado. Nunca en base de datos ni en archivos de configuración externos.

## Protocolo WebSocket (MVP)

Formato básico de mensajes entre cliente y servidor. Todos los mensajes incluyen `"version": "1"`. Los mensajes cliente→servidor incluyen `"id"` (UUID v4) como correlation ID para trazabilidad end-to-end.

```json
// Cliente → Servidor
{ "version": "1", "id": "<uuid-v4>", "type": "audio_chunk", "data": "<base64>" }
{ "version": "1", "id": "<uuid-v4>", "type": "audio_end" }
{ "version": "1", "id": "<uuid-v4>", "type": "auth", "token": "<token>", "audio_format": "mp3" }  // audio_format es opcional: "mp3" (default) o "pcm"
{ "version": "1", "id": "<uuid-v4>", "type": "audio_start" }  // Inicia grabación de audio
{ "version": "1", "id": "<uuid-v4>", "type": "audio_mute" }   // Silencia micrófono temporalmente
{ "version": "1", "id": "<uuid-v4>", "type": "audio_unmute" } // Reanuda micrófono

// Servidor → Cliente
{ "version": "1", "type": "auth_ok", "session_id": "<uuid-v4>", "audio_format": "mp3", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "audio_chunk", "data": "<base64>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "audio_end", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "text", "content": "<texto>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "processing", "content": "<texto>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "action_result", "ok": true, "action": "<respond|create_task|start_task|update_task|complete_task|cancel_task|postpone_task|create_objective|update_objective|complete_objective|cancel_objective|pause_objective|resume_objective|store_memory|query_list|create_list|add_list_items|check_list_item|uncheck_list_item|complete_list|cancel_list>", "correlation_id": "<uuid-v4>", "payload": { ... } }
{ "version": "1", "type": "notification", "level": "<warning|reminder>", "message": "...", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "error", "code": "<code>", "message": "...", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "transcript", "content": "<texto del usuario>", "correlation_id": "<uuid-v4>" }
{ "version": "1", "type": "agent_state", "state": "listening|thinking|speaking", "correlation_id": "<uuid-v4>" }
```

### Formato de audio

- **Entrada (STT)**: PCM signed 16-bit little-endian, 16 kHz, mono. Alternativamente MP3/Opus según soporte de Whisper API.
- **Salida (TTS)**: MP3 por defecto. PCM si el cliente lo solicita en `auth`.
- **Negociación**: el mensaje `auth` puede incluir un campo opcional `"audio_format"` con valores `"mp3"` (default) o `"pcm"`. `auth_ok` siempre incluye el campo `audio_format` confirmando el formato al cliente (el default es `"mp3"` si el cliente no lo especifica en `auth`).

### Códigos de error

| Código            | Descripción                                       |
| ----------------- | ------------------------------------------------- |
| `AUTH_FAILED`     | Token inválido o ausente                          |
| `STT_ERROR`       | Falló la transcripción de audio                   |
| `LLM_TIMEOUT`     | Timeout en llamada a LLM (vía rápida o lenta)     |
| `TTS_ERROR`       | Falló la generación de audio                      |
| `RATE_LIMITED`    | Demasiados mensajes en poco tiempo                |
| `INVALID_MESSAGE` | Mensaje con formato inválido o type desconocido   |
| `INTERNAL_ERROR`  | Error genérico del servidor (no exponer detalles) |

### Idempotencia de mensajes

- La deduplicación por `id` aplica únicamente a mensajes discretos (`auth`, `audio_end`, y futuros comandos de texto). Los `audio_chunk` se procesan sin deduplicación debido a su volumen (~50 msgs/seg).
- El servidor almacena los últimos N ids procesados en memoria, configurable via `ID_CACHE_SIZE` (default: 1000) con TTL configurable via `ID_CACHE_TTL_MS` (default: 300000 = 5 min).
- Si llega un `id` duplicado dentro del TTL, el servidor ignora el mensaje y responde con el resultado cacheado (si ya fue procesado) o lo descarta (si está en proceso).
- El `id` se propaga como `correlation_id` en todas las respuestas asociadas a ese mensaje, incluyendo `auth_ok`, `text`, `action_result` y los demás mensajes de respuesta.
- El campo `id` en `audio_chunk` se ignora para deduplicación pero se puede usar para trazabilidad en logs del servidor. Para ahorrar ancho de banda, el cliente puede omitir el `id` en `audio_chunk`.

### Reconexión del cliente

- Política de reconnect con backoff exponencial: 1s, 2s, 4s, 8s, 16s, 30s cap.
- Al reconectarse, el cliente debe reenviar el mensaje `auth` como primer mensaje.
- No se reenvían `audio_chunk` del turno anterior: la sesión de audio se descarta al desconectarse.
- Al reconectarse, se genera un nuevo `session_id`. Los `conversation_turns` de la sesión anterior permanecen disponibles en BD.

### Sesiones y contexto conversacional

- Cada conexión WebSocket autenticada recibe un `session_id` (UUID v4) en la respuesta `auth_ok`.
- El servidor almacena cada intercambio (mensaje del usuario y respuesta del sistema) en la tabla `conversation_turns` con el `session_id` correspondiente.
- La vía lenta consulta los últimos N turns de la sesión actual como contexto conversacional para gpt-5-mini (N es configurable via `CONVERSATION_TURNS_LIMIT`, default: 10), además de las memorias a largo plazo.

### Edge cases del protocolo

- Si llega un `audio_end` sin `audio_chunk` previos en la sesión, el servidor envía error `INVALID_MESSAGE` y descarta el mensaje.
- Si la vía rápida agota el timeout (`FAST_LANE_TIMEOUT_MS`), el servidor envía `text` con "Un momento, estoy procesando..." seguido de `audio_end` para cerrar el turno. El cliente debe recibir el `audio_end` para poder volver al estado `idle` y aceptar nuevo audio.
- Si TTS falla (cuando esté integrado), el servidor envía `text` sin `audio_chunk`, pero siempre envía `audio_end` para cerrar el turno. El cliente debe manejar `audio_end` con buffer de audio vacío volviendo a `idle`.
- Si el servidor envía un error (`STT_ERROR`, `INVALID_MESSAGE`, etc.), el cliente debe transicionar de `processing` a `idle` para permitir un nuevo intento de grabación.
- El cliente implementa un timeout de seguridad (30 s) en el estado `processing`: si no recibe respuesta del servidor, vuelve a `idle` automáticamente.

## Autenticación (MVP)

- Token estático compartido, enviado como primer mensaje WebSocket (`auth`).
- El token se compara contra la variable de entorno `AUTH_TOKEN`.
- Sin endpoint REST de registro. El token es estático.
- Conexión WebSocket rechazada si el primer mensaje no es `auth` o el token no coincide.
- Sistema mono-usuario: no se contempla multi-usuario.

## Seguridad y rate limiting

- Rate limit por conexión WebSocket: configurable via `RATE_LIMIT_AUDIO` (default: 50 msgs/seg para `audio_chunk`), `RATE_LIMIT_OTHER` (default: 10 msgs/seg para otros tipos).
- Validación de schema en cada mensaje entrante: el campo `type` debe ser uno de los valores permitidos, `data` no puede exceder `WS_MAX_PAYLOAD` (default: 1 MB).
- Timeout de inactividad: configurable via `WS_IDLE_TIMEOUT_MS` (default: 5 min), si no hay mensajes en ese período, se cierra la conexión.
- Nunca exponer trazas de error internas al cliente. Los errores de WS usan los códigos definidos arriba sin detalles de implementación.

## Variables de entorno

Lista de nombres requeridos (sin valores):

- `OPENAI_API_KEY`
- `FCM_SERVICE_ACCOUNT` (ruta al archivo JSON de Service Account de Firebase)
- `DATABASE_URL` (PostgreSQL)
- `AUTH_TOKEN` (token estático para acceso)
- `PORT` (default: 3000)
- `NODE_ENV`

Nunca codificar valores directamente en el código.

### Variables de entorno opcionales

| Variable                   | Default      | Descripción                                                                           |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                | `info`       | Nivel de log (trace/debug/info/warn/error/fatal)                                      |
| `JOB_MAX_ATTEMPTS`         | `3`          | Reintentos antes de marcar job como failed                                            |
| `JOB_ORPHAN_TIMEOUT_MS`    | `600000`     | Timeout para jobs huérfanos (10 min)                                                  |
| `WS_MAX_PAYLOAD`           | `1048576`    | Tamaño máximo de mensaje WebSocket (1 MB)                                             |
| `WS_IDLE_TIMEOUT_MS`       | `300000`     | Timeout de inactividad WebSocket (5 min)                                              |
| `RATE_LIMIT_AUDIO`         | `50`         | Mensajes/seg para `audio_chunk`                                                       |
| `RATE_LIMIT_OTHER`         | `10`         | Mensajes/seg para otros tipos de mensaje                                              |
| `EMBEDDING_DIMENSION`      | `1536`       | Dimensión de vectores pgvector                                                        |
| `FAST_LANE_TIMEOUT_MS`     | `5000`       | Timeout para vía rápida en milisegundos (modelo configurable via `OPENAI_FAST_MODEL`) |
| `OPENAI_STT_MODEL`         | `whisper-1`  | Modelo de OpenAI para STT                                                             |
| `OPENAI_FAST_MODEL`        | `gpt-5-nano` | Modelo de OpenAI para vía rápida                                                      |
| `OPENAI_SLOW_MODEL`        | `gpt-5-mini` | Modelo de OpenAI para vía lenta                                                       |
| `OPENAI_TTS_MODEL`         | `tts-1-hd`   | Modelo de OpenAI para TTS                                                             |
| `OPENAI_TTS_VOICE`         | `nova`       | Voz de OpenAI TTS (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`)               |
| `CONVERSATION_TURNS_LIMIT` | `10`         | Cantidad de turns de contexto conversacional por sesión                               |
| `MEMORY_RETRIEVAL_LIMIT`   | `5`          | Cantidad de memorias relevantes (top-K) a recuperar                                   |
| `ID_CACHE_SIZE`            | `1000`       | Cantidad máxima de IDs en cache de idempotencia                                       |
| `ID_CACHE_TTL_MS`          | `300000`     | TTL del cache de idempotencia en milisegundos (5 min)                                 |

## Manejo de errores

- Errores de la vía rápida: si el modelo configurado via `OPENAI_FAST_MODEL` falla o expira el timeout, enviar respuesta genérica al cliente y dejar que la vía lenta responda (jobs ya encolados).
- Errores de la vía lenta: reintentar hasta 3 veces con backoff exponencial (base 2 s, multiplicador 2, jitter ±20%), luego marcar como fallido en la cola.
- Errores de integraciones externas (OpenAI: STT, LLM vía lenta): timeout de 10 s, fallback a respuesta genérica si falla la vía rápida.
- Nunca exponer detalles de errores internos al usuario final.
- Los logs contienen contexto útil (incluyendo `correlation_id` cuando esté disponible) pero **nunca** secretos, tokens ni transcripciones completas.
- Si una acción de la vía lenta falla, las acciones posteriores sin `depends_on` se ejecutan normalmente. Solo las acciones que tengan `depends_on` apuntando a la acción fallida reciben `PREVIOUS_ACTION_FAILED`.

## Testing

- Framework: Vitest.
- Ubicación: `backend/src/**/*.test.ts` junto al código fuente.
- Estrategia:
  - Unit tests para reglas de negocio (`domain/`), máquina de estados de tareas y objetivos.
  - Integration tests para API endpoints y WebSocket handlers.
  - Los tests de integraciones externas (OpenAI: STT, LLM, TTS, embeddings) usan mocks.
- Prioridad de cobertura: `domain/` > `api/` > `workers/` > `llm/`.
- Ejecutar `pnpm test` antes de dar por terminado cualquier cambio en `domain/` o `api/`.
- Flutter: smoke tests mínimos de conexión WebSocket + auth flow en `appmovil/test/`. No se requiere unit testing de UI en MVP.

## Project commands

> El proyecto aún no tiene `package.json`. Cuando se cree, esta sección se actualizará con los scripts reales. Usa siempre los scripts definidos en `package.json`; no inventes comandos.

Comandos esperados (se confirmarán al crear el proyecto):

- `pnpm dev` – levantar servidor HTTP/WebSocket.
- `pnpm test` – ejecutar tests.
- `pnpm lint` – comprobar estilo y reglas.
- `pnpm prisma:migrate` – aplicar migraciones.
- `pnpm worker` – levantar worker de vía lenta (si existe script separado).

## Glosario

- **Interacción significativa**: mensaje del usuario que implica una decisión o declaración de preferencia. La vía lenta determina si un mensaje es significativo.
- **Contexto** (de tarea): metadata estructurada (JSONB) asociada a una tarea (ubicación, hora del día, dispositivo, estado emocional percibido). Ayuda a la vía lenta a tomar decisiones con más información.
- **Vía rápida**: flujo de baja latencia (< 2 s) que confirma recepción y mantiene la conversación fluida. No escribe en BD.
- **Vía lenta**: flujo asíncrono (< 30 s P95) que procesa la intención, aplica reglas de negocio y ejecuta CRUD.
- **Correlation ID**: UUID v4 que acompaña cada mensaje desde el cliente hasta la respuesta final, permitiendo trazabilidad end-to-end.
- **Session ID**: UUID v4 generado por el servidor al autenticar una conexión WebSocket. Agrupa los `conversation_turns` de una sesión.

## Roadmap de fases

| Fase | Nombre                | Alcance                                                                                                                                                                                                                                                                    |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **MVP**               | Conexión WebSocket, STT (Whisper), vía rápida (modelo configurable via `OPENAI_FAST_MODEL`), vía lenta (modelo configurable via `OPENAI_SLOW_MODEL`), CRUD básico de tareas y objetivos, Auth con token estático, cola PostgreSQL, conversación contextual con session_id. |
| 2    | **Memoria**           | RAG con pgvector, notificaciones push (FCM), consolidación de memorias.                                                                                                                                                                                                    |
| 3    | **Personal avanzado** | Clon de voz, inferencia de personalidad, métricas de uso, ajuste dinámico de prompts.                                                                                                                                                                                      |
| 4    | **Producción**        | Docker/OCI, CI/CD, monitoreo, escalar job queue a Graphile Worker/BullMQ.                                                                                                                                                                                                  |

Decisiones marcadas como "MVP" o "Fase 1" son temporales. Las invariantes de negocio (doble vía, voz‑first, mono‑usuario) son permanentes.

## Health checks y métricas mínimas

- **Endpoint**: `GET /health` devuelve `{ status: "ok", timestamp: "<ISO 8601>" }` y verifica conexión a PostgreSQL.
- **Métricas internas** (en memoria, sin dependencias externas):
  - Latencia P95 de vía rápida y vía lenta.
  - Jobs por estado (`pending`, `processing`, `completed`, `failed`).
  - Tasa de error por integración (OpenAI: STT, LLM, TTS).
- **Loguear métricas**: cada 60 segundos a nivel `info`.

## Agent guidelines (para OpenCode)

- Entiende el flujo de doble vía antes de modificar lógica de conversación o workers.
- Mantén la separación de responsabilidades: vía rápida = sin lógica, vía lenta = lógica de negocio.
- Nunca conviertas el sistema en un asistente complaciente (ver `Personalidad del clon`).
- Nunca expongas secretos en el código.
- No modifiques infraestructura de despliegue sin instrucción explícita.
- No introduzcas dependencias fuertes de la app móvil en el backend.
- Ejecuta tests relevantes antes de dar por terminado un cambio. Si no hay tests para una pieza crítica, propón añadirlos.
- Sigue Prettier, ESLint y el `tsconfig` existentes. Prefiere tipos estrictos en TypeScript; evita `any`, `as unknown as T`, non-null assertion `!` y `@ts-ignore`. Usa type guards, discriminated unions y `unknown` con narrowing.
- Usa **pnpm** como package manager.
- Usa el patrón `Result<T, E>` en `domain/` para manejo de errores.
- Usa `correlation_id` en logs y respuestas para trazabilidad end-to-end.

### Cuando modifiques el proyecto

Si un cambio afecta:

- El flujo de doble vía.
- El modelo de datos de tareas/objetivos.
- La personalidad del clon o cómo se construye.
- La integración con servicios de IA o notificaciones.
- El protocolo WebSocket o el formato de mensajes.

Entonces:

1. Actualiza este `AGENTS.md` en el mismo commit.
2. Añade o actualiza tests relevantes.
3. Deja comentarios claros si introduces nuevas invariantes de negocio.

### Actualización de la checklist

Cada vez que se realice una modificación al proyecto (agregar funcionalidad, completar una tarea, cambiar arquitectura, etc.), actualiza la sección **Development Checklist** de este archivo para reflejar el estado actual del progreso. Marcar los items completados con `[x]` y agregar nuevos items si corresponde.

### Safety & boundaries

- No leer ni mostrar contenido de `.env`, archivos de claves, o configuraciones sensibles.
- No cambiar scripts de despliegue a producción sin instrucción explícita.
- No desactivar validaciones que impiden acciones peligrosas (ej.: saltarse la vía lenta para escribir en base de datos directamente).
- Añadir logs útiles sin datos sensibles.
- Refactorizar para legibilidad y testeabilidad sin cambiar reglas de negocio, salvo instrucción explícita.

### Working with mobile clients

- El backend expone APIs/WebSockets genéricos, reutilizables por otros clientes.
- No acoplar lógica de UI móvil en el servidor.
- El stack mobile es **Flutter**. Respetar sus convenciones.
- La lógica de negocio vive en el backend; la app móvil es solo presentación y captura de audio.

## Development Checklist

### Fase 1 – MVP (Completada)

#### Backend – Infraestructura

- [x] Estructura de carpetas definida
- [x] `package.json` con scripts
- [x] TypeScript configurado
- [x] Fastify + WebSocket
- [x] Prisma + PostgreSQL + pgvector
- [x] Variables de entorno (`env.ts`)
- [x] Logger con pino
- [x] Docker Compose (PostgreSQL + pgvector)
- [x] Migración inicial

#### Backend – Autenticación

- [x] Token estático
- [x] Middleware de auth para WebSocket
- [x] Tests de autenticación (`auth/index.test.ts`)

#### Backend – API

- [x] Health check (`GET /health`)
- [x] WebSocket handler (`ws.ts`)
- [x] Protocolo de mensajes (auth, audio_chunk, audio_end)
- [x] Idempotencia de mensajes (ID cache)
- [x] Rate limiting
- [x] Timeout de inactividad
- [x] Tests de API endpoints (`health.test.ts`)
- [x] Tests de WebSocket handler (`ws.test.ts`)

#### Backend – Integraciones OpenAI

- [x] Cliente OpenAI
- [x] STT (Whisper API) — activo en el flujo de producción
- [x] LLM vía rápida (gpt-5-nano) — activo en el flujo de producción
- [x] LLM vía lenta (gpt-5-mini)
- [x] TTS (tts-1-hd) — función existente (`llm/tts.ts`) pero no integrada en el flujo de producción
- [x] Embeddings (text-embedding-3-small)
- [x] Prompts: fast-lane-system, slow-lane-system, slow-lane-actions (vía lenta)
- [x] Tests de integraciones (con mocks)

#### Backend – Dominio

- [x] Modelo de tareas + máquina de estados
- [x] Modelo de objetivos + máquina de estados
- [x] Modelo de listas + máquina de estados
- [x] Modelo de mensajes
- [x] Patrón `Result<T, E>`
- [x] Tests de listas (`list.test.ts`)
- [x] Tests de máquina de estados de tareas (`task.test.ts`)
- [x] Tests de máquina de estados de objetivos (`objective.test.ts`)

#### Backend – Base de datos

- [x] Schema Prisma completo (Task, Objective, Memory, ConversationTurn, Job, List)
- [x] Repositorios: task, objective, list, memory, conversation, job
- [x] Seed con datos iniciales
- [x] Tests de repositorios (task, objective, memory, conversation, list, job)

#### Backend – Workers (vía lenta)

- [x] Procesador de vía lenta (`slow-lane-processor.ts`)
- [x] Action handlers (`action-handlers.ts`)
- [x] Entry point del worker (`workers/index.ts`)
- [x] Cola PostgreSQL (polling con `SELECT ... FOR UPDATE SKIP LOCKED`)
- [x] Recovery de jobs huérfanos
- [x] Reintentos con backoff exponencial
- [x] Tests de workers (`slow-lane-processor.test.ts`, `job-repository.test.ts`)

#### Backend – Lists (CRUD completo)

- [x] `create_list`
- [x] `add_list_items`
- [x] `check_list_item`
- [x] `uncheck_list_item`
- [x] `complete_list`
- [x] `cancel_list`

#### Backend – Tareas (CRUD completo)

- [x] `create_task`
- [x] `start_task`
- [x] `update_task`
- [x] `complete_task`
- [x] `cancel_task`
- [x] `postpone_task`

#### Backend – Objetivos (CRUD completo)

- [x] `create_objective`
- [x] `update_objective`
- [x] `complete_objective`
- [x] `cancel_objective`
- [x] `pause_objective`
- [x] `resume_objective`

#### Backend – Memoria

- [x] `store_memory`
- [x] Integración de embeddings en worker
- [x] RAG: consulta top-K memorias por similitud

#### Backend – Quick Memory (Cache en RAM)

- [x] Módulo singleton en `domain/quick-memory.ts` (get/update/formatForPrompt)
- [x] Acción `update_quick_memory` en vía lenta (handler + router)
- [x] Inyección en prompt de vía rápida desde `ws.ts`
- [x] Prompt de fast lane actualizado para usar el contexto
- [x] `whoAmI` auto-inferido de memorias con preferencias
- [x] `topData` con mix inteligente: tareas, objetivos, listas, eventos
- [x] `todayContext` con lo que vence hoy + en progreso
- [x] `recentTopics` con frecuencia léxica de últimas memorias
- [x] Truncamiento a 700 tokens (~2800 chars) preservando secciones prioritarias
- [x] Tests de formato y truncamiento

#### Backend – Calendario (Eventos)

- [x] Schema Prisma: Event + TaskEventLink + EventStatus
- [x] Dominio: máquina de estados de eventos + lógica de recurrencia
- [x] Repositorio: event-repository.ts con CRUD, recurrencia, excepciones, links
- [x] Tests de dominio (event.test.ts) y repositorio (event-repository.test.ts)
- [x] `create_event`
- [x] `update_event`
- [x] `delete_event`
- [x] `query_events`
- [x] `move_event_instance` (excepciones de recurrencia)
- [x] `update_recurrence_rule`
- [x] `link_task_event`
- [x] `unlink_task_event`
- [x] Prompt del slow lane: sección de eventos próximos + nuevas acciones
- [x] Contexto de eventos próximos en slow-lane-processor
- [x] Tests de integración (action-handlers.test.ts)

#### Backend – Respuesta conversacional

- [x] `respond`: acción para responder con texto usando contexto (tareas, listas, objetivos)
- [x] `query_list` sin `list_title`: retorna todas las listas activas
- [x] Prompt del slow lane mejorado para usar `respond` en preguntas informativas
- [x] Prompt del fast lane mejorado con respuestas dinámicas según lo que el usuario dijo
- [x] Tests de `handleRespond`, `query_list` sin título, `respond` en format-response

#### Backend – Contexto conversacional

- [x] Tabla `conversation_turns`
- [x] Almacenamiento de turns por sesión
- [x] Consulta de últimos N turns como contexto para gpt-5-mini

#### Backend – Notificaciones

- [x] Firebase Cloud Messaging (FCM)
- [x] Notificaciones push para recordatorios
- [x] Notificaciones por WebSocket de action_results

#### Backend – Testing

- [x] `list.test.ts`
- [x] `task.test.ts`
- [x] `objective.test.ts`
- [x] `health.test.ts`
- [x] `ws.test.ts`
- [x] `auth/index.test.ts`
- [x] Tests de workers (`slow-lane-processor.test.ts`, `job-repository.test.ts`)
- [x] Tests de repositorios (task, objective, memory, conversation, list, job)
- [x] Tests de integraciones LLM (mocks)
- [x] Tests de FCM (fcm.test.ts)
- [x] Tests de device repository

#### App Móvil (Flutter)

- [x] Inicializar proyecto Flutter
- [x] Captura de audio (PCM 16-bit, 16kHz, mono) — legacy, reemplazado por WebRTC
- [x] Conexión WebSocket — legacy para control messages, reemplazado vía WebRTC para audio
- [x] Flujo de auth
- [x] Envío de audio_chunks — legacy, reemplazado por WebRTC streaming continuo
- [x] Recepción y reproducción de audio TTS — legacy, reemplazado por WebRTC
- [x] Manejo de reconexión con backoff exponencial
- [x] WebRTC service (`webrtc_service.ts`) — micrófono continuo, reproducción automática
- [x] AudioService reescrito para WebRTC + control messages
- [x] Voice indicator widget (sin push-to-talk)
- [x] Smoke tests

#### Documentación

- [x] AGENTS.md
- [x] docker-compose.yml
- [x] docs/infra-setup.md

---

### Fase 2 – Memoria (Parcial)

- [x] RAG con pgvector (consulta top-K memorias en vía lenta)
- [x] FCM: notificaciones push configuradas
- [x] Notificaciones proactivas (recordatorios, replanificaciones)
- [ ] Consolidación periódica de memorias
- [x] Tests de RAG

---

### Fase 3 – Personal avanzado (Pendiente)

- [ ] Clon de voz (fine-tuning o configuración avanzada de TTS)
- [ ] Inferencia de personalidad basada en historial
- [ ] Métricas de uso
- [ ] Ajuste dinámico de prompts

---

### Bug fixes

- [x] Fix: client stuck in `processing` state when server sends error (INVALID_MESSAGE, STT_ERROR)
- [x] Fix: server sends `audio_end` to close turn on fast lane timeout and TTS failure
- [x] Fix: client handles `ErrorMessage` in `AudioService._onMessage` to transition back to `idle`
- [x] Fix: client adds 30s timeout on `processing` state as safety net
- [x] Tests: updated ws.test.ts to verify `audio_end` on timeout and TTS failure
- [x] Fix: `max_tokens` → `max_completion_tokens` for GPT-5 compatibility (`fast-lane.ts`, `slow-lane.ts`)
- [x] Fix: enhanced error logging in `slow-lane.ts` to log raw LLM response on parse failure
- [x] Fix: improve slow-lane prompt to handle empty database context
- [x] Fix: add fallback `text` response to user when action extraction exhausts all retries

---

### Fase 4 – Producción (Pendiente)

- [ ] Dockerización completa
- [ ] Deploy en OCI (Oracle Cloud)
- [ ] CI/CD pipeline
- [ ] Monitoreo y alerting
- [ ] Escalar job queue a Graphile Worker o BullMQ
- [ ] Worker de vía lenta en proceso separado
