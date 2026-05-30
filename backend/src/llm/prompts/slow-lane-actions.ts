export const SLOW_LANE_ACTIONS_PROMPT = `
## Acciones disponibles

### respond
Payload: { messages: string[], display?: DisplayEntity[] }

DisplayEntity: task ({type, title, priority, status, dueDate?}) |
list ({type, title, items: [{content, quantity?, checked?}]}) |
objective ({type, title, status, deadline?}) |
event ({type, title, startTime, endTime?, location?, recurrence?, category?}) |
memory ({type, content})

### store_memory
Payload: { content: string, metadata?: { interaction_type?: string, entities?: string[], context?: string } }

### create_task
Payload: { title: string, description?: string, due_date?: ISO8601, objective_id?: UUID, priority?: "low"|"medium"|"high", context?: object }
Nota: priority default es "medium" si no se provee.

### start_task
Payload: { task_id: UUID }

### update_task
Payload: { task_id: UUID, title?, description?, due_date?, objective_id?, priority?, context? }

### complete_task
Payload: { task_id: UUID }

### cancel_task
Payload: { task_id: UUID }

### postpone_task
Payload: { task_id: UUID, due_date: ISO8601 }

### create_objective
Payload: { title: string, description?: string, deadline?: ISO8601 }

### update_objective
Payload: { objective_id: UUID, title?, description?, deadline? }

### complete_objective
Payload: { objective_id: UUID }
Nota: falla si el objetivo tiene tareas pending o in_progress (OBJECTIVE_HAS_PENDING_TASKS).

### cancel_objective
Payload: { objective_id: UUID }
Efecto cascada: tareas asociadas pending/in_progress/postponed → cancelled.

### pause_objective
Payload: { objective_id: UUID }

### resume_objective
Payload: { objective_id: UUID }

### create_list
Payload: { title: string, type?: string, description?: string, items?: [{ content: string, quantity?: string }] }

### add_list_items
Payload: { list_id: UUID, items: [{ content: string, quantity?: string }] }

### check_list_item
Payload: { list_id: UUID, item_index: number }

### uncheck_list_item
Payload: { list_id: UUID, item_index: number }

### complete_list
Payload: { list_id: UUID }
Nota: todos los items deben estar checked.

### cancel_list
Payload: { list_id: UUID }

### query_list
Payload: { list_title?: string }
Nota: si se omite list_title, retorna todas las listas activas.

### create_event
Payload: { title: string, start_time: ISO8601, end_time?: ISO8601, description?: string, location?: string, category?: string, recurrence_rule?: { frequency: "daily"|"weekly"|"monthly"|"yearly", interval?: number, daysOfWeek?: number[], dayOfMonth?: number, monthOfYear?: number, endDate?: ISO8601, count?: number } }

### update_event
Payload: { event_id: UUID, title?, description?, location?, category?, start_time?, end_time? }

### delete_event
Payload: { event_id: UUID }

### query_events
Payload: { start_date?: ISO8601, end_date?: ISO8601 }

### move_event_instance
Payload: { event_id: UUID, new_start_time: ISO8601, new_end_time?: ISO8601, exception_date?: ISO8601 }

### update_recurrence_rule
Payload: { event_id: UUID, recurrence_rule: object }

### link_task_event
Payload: { task_ids: UUID|UUID[], event_ids: UUID|UUID[] }

### unlink_task_event
Payload: { task_ids: UUID|UUID[], event_ids: UUID|UUID[] }

### update_quick_memory
Payload: {}
Usar después de CRUD que cambie el contexto del usuario (no en consultas de solo lectura).
`.trim();
