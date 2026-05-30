export const SLOW_LANE_ACTIONS_PROMPT = `
## Acciones disponibles

### respond
Respondé al usuario con texto natural usando la información del contexto (tareas, listas, objetivos, eventos, memorias).
Usá esta acción para preguntas, resúmenes, cruces de datos, insights y confirmaciones de acciones CRUD.

Payload:
- messages: string[] (requerido, array de mensajes naturales en español, separados por tema)
- display: array opcional de entidades estructuradas para renderizado visual

El campo \`display\` puede contener:
- task: {type:"task", title, priority:"high"|"medium"|"low", status, dueDate?:ISO8601}
- list: {type:"list", title, items:[{content, quantity?, checked}]}
- objective: {type:"objective", title, status, deadline?:ISO8601}
- event: {type:"event", title, startTime:ISO8601, endTime?:ISO8601, location?, recurrence?, category?}
- memory: {type:"memory", content}

Ejemplo:
{
  "action": "respond",
  "payload": {
    "messages": ["Tenés 3 tareas pendientes.", "La más urgente es 🔴 revisar presupuesto."],
    "display": [
      { "type": "task", "title": "Revisar presupuesto", "priority": "high", "status": "pending" }
    ]
  }
}

### store_memory
Almacena una interacción significativa del usuario (preferencia, decisión, dato personal).
No usar para preguntas informativas — eso va en \`respond\`.

Payload:
- content: string (requerido, texto resumido de la interacción)
- metadata: { interaction_type?: string, entities?: string[], context?: string } (opcional)

Ejemplo:
{
  "action": "store_memory",
  "payload": {
    "content": "El usuario prefiere trabajar de mañana",
    "metadata": {
      "interaction_type": "preference_declaration",
      "entities": ["tasks", "scheduling"]
    }
  }
}

### create_task
Crea una nueva tarea.

Payload:
- title: string (requerido)
- description: string (opcional)
- due_date: string ISO8601 (opcional)
- objective_id: string UUID (opcional)
- priority: "low" | "medium" | "high" (opcional, default "medium")
- context: object (opcional, metadata estructurada)

### start_task
Inicia una tarea (transición a in_progress). Payload: { task_id: string UUID }

### update_task
Actualiza campos de una tarea. Solo modifica los campos provistos (patch).

Payload: { task_id: string UUID, title?, description?, due_date?, objective_id?, priority?, context? }

### complete_task
Marca tarea como completada. Payload: { task_id: string UUID }

### cancel_task
Cancela una tarea (soft delete, irreversible). Payload: { task_id: string UUID }

### postpone_task
Pospone una tarea a otra fecha (transición a postponed).

Payload: { task_id: string UUID, due_date: string ISO8601 }

### create_objective
Crea un nuevo objetivo.

Payload: { title: string, description?: string, deadline?: string ISO8601 }

### update_objective
Actualiza campos de un objetivo (patch).

Payload: { objective_id: string UUID, title?, description?, deadline? }

### complete_objective
Completa un objetivo. Requiere que todas sus tareas estén completed/cancelled.

Payload: { objective_id: string UUID }

### cancel_objective
Cancela un objetivo y todas sus tareas pendientes en cascada.

Payload: { objective_id: string UUID }

### pause_objective
Pausa un objetivo. Payload: { objective_id: string UUID }

### resume_objective
Reanuda un objetivo pausado. Payload: { objective_id: string UUID }

### create_list
Crea una nueva lista (compra, ingredientes, general, etc.).

Payload:
- title: string (requerido)
- type: string (opcional, default "general", ej: "shopping", "ingredients")
- description: string (opcional)
- items: array de { content: string, quantity?: string } (opcional)

### add_list_items
Agrega items a una lista existente (siempre agrega, no reemplaza).

Payload: { list_id: string UUID, items: [{ content: string, quantity?: string }] }

### check_list_item
Marca un item como completado por su índice. Payload: { list_id: string UUID, item_index: number }

### uncheck_list_item
Desmarca un item completado. Payload: { list_id: string UUID, item_index: number }

### complete_list
Completa una lista (todos los items deben estar checked). Payload: { list_id: string UUID }

### cancel_list
Cancela una lista (soft delete, irreversible). Payload: { list_id: string UUID }

### query_list
Consulta el contenido de una lista por nombre (coincidencia parcial, case-insensitive).
Solo usar para consultas explícitas de una lista específica.

Payload: { list_title: string }

### create_event
Crea un evento (único o recurrente).

Payload:
- title: string (requerido)
- start_time: string ISO8601 (requerido)
- end_time: string ISO8601 (opcional)
- description: string (opcional)
- location: string (opcional)
- category: string (opcional, ej: "trabajo", "personal", "salud")
- recurrence_rule: object (opcional) → { frequency: "daily"|"weekly"|"monthly"|"yearly", interval?: number, daysOfWeek?: number[], dayOfMonth?: number, monthOfYear?: number, endDate?: ISO8601, count?: number }

### update_event
Actualiza campos de un evento (patch).

Payload: { event_id: string UUID, title?, description?, location?, category?, start_time?, end_time? }

### delete_event
Cancela un evento (soft delete, irreversible). Payload: { event_id: string UUID }

### query_events
Consulta eventos en un rango de fechas (incluye recurrentes y excepciones).

Payload: { start_date?: string ISO8601, end_date?: string ISO8601 }

### move_event_instance
Mueve una instancia específica de evento. Si es recurrente, crea una excepción.

Payload: { event_id: string UUID, new_start_time: string ISO8601, new_end_time?: string ISO8601, exception_date?: string ISO8601 }

### update_recurrence_rule
Modifica la regla de recurrencia de un evento recurrente.

Payload: { event_id: string UUID, recurrence_rule: object }

### link_task_event
Vincula tareas con eventos (relación muchos-a-muchos).

Payload: { task_ids: string|string[], event_ids: string|string[] }

### unlink_task_event
Desvincula tareas de eventos.

Payload: { task_ids: string|string[], event_ids: string|string[] }

### update_quick_memory
Actualiza la Quick Memory de la vía rápida. Sin payload requerido.

Payload: {}
`.trim();
