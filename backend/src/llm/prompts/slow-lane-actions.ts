export const SLOW_LANE_ACTIONS_PROMPT = `
## Acciones disponibles

### respond
Respondé al usuario con texto natural usando la información del contexto (tareas, listas, objetivos, memorias).
Usá esta acción para preguntas, resúmenes, cruces de datos e insights.

Payoad:
- messages: string[] (requerido, array de mensajes naturales en español)
- display: array opcional de entidades estructuradas para renderizado visual

El campo \`display\` puede contener los siguientes tipos de entidades:

- **task**: {type:"task", title, priority:"high"|"medium"|"low", status:"pending"|"in_progress"|"completed"|"postponed"|"cancelled", dueDate?:ISO8601}
- **list**: {type:"list", title, items:[{content, quantity?, checked}]}
- **objective**: {type:"objective", title, status:"active"|"paused"|"completed"|"cancelled", deadline?:ISO8601}
- **event**: {type:"event", title, startTime:ISO8601, endTime?:ISO8601, location?, recurrence?, category?}
- **memory**: {type:"memory", content}

Ejemplo con display:
{
  "action": "respond",
  "payload": {
    "messages": ["Tenes 3 tareas pendientes.", "La mas urgente es 🔴 revisar el presupuesto."],
    "display": [
      { "type": "task", "title": "Revisar presupuesto", "priority": "high", "status": "pending" },
      { "type": "task", "title": "Comprar leche", "priority": "medium", "status": "pending" }
    ]
  }
}

📌 Para consultas generales del tipo "dame información", "qué tengo", "cómo voy", "contame todo": incluí display entities de TODOS los tipos disponibles (task, objective, list, event, memory) en un solo respond. No fragmentes en múltiples acciones ni uses query_list para esto.

### query_list
Consulta el contenido de una lista existente sin modificarla.
El sistema busca la lista por nombre (coincidencia parcial, sin distinguir mayúsculas).

Payload:
- list_title: string (requerido, nombre o parte del nombre de la lista)

⚠️ Solo usar para consultas específicas de una lista por nombre. Para consultas generales sobre el estado del sistema, usá \`respond\` con display entities múltiples.

Ejemplo:
{
  "action": "query_list",
  "payload": {
    "list_title": "Lista del supermercado"
  }
}

### create_list
Crea una nueva lista (compra, ingredientes, tareas pendientes, etc.).
El campo \`type\` es un string flexible: "shopping", "ingredients", "general", etc.

Payload:
- title: string (requerido)
- type: string (opcional, default "general")
- description: string (opcional)
- items: array de { content: string, quantity?: string } (opcional)

Ejemplo:
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

### add_list_items
Agrega uno o más items a una lista existente.

Payload:
- list_id: string (UUID, requerido)
- items: array de { content: string, quantity?: string } (requerido)

Ejemplo:
{
  "action": "add_list_items",
  "payload": {
    "list_id": "uuid-de-la-lista",
    "items": [
      { "content": "Pan", "quantity": "1 kg" }
    ]
  }
}

### check_list_item
Marca un item como completado por su índice en el array.

Payload:
- list_id: string (UUID, requerido)
- item_index: number (índice 0-based, requerido)

Ejemplo:
{
  "action": "check_list_item",
  "payload": {
    "list_id": "uuid-de-la-lista",
    "item_index": 0
  }
}

### uncheck_list_item
Desmarca un item completado.

Payload:
- list_id: string (UUID, requerido)
- item_index: number (índice 0-based, requerido)

Ejemplo:
{
  "action": "uncheck_list_item",
  "payload": {
    "list_id": "uuid-de-la-lista",
    "item_index": 1
  }
}

### complete_list
Marca la lista como completada. Solo válido si todos los items están checked.

Payload:
- list_id: string (UUID, requerido)

Ejemplo:
{
  "action": "complete_list",
  "payload": {
    "list_id": "uuid-de-la-lista"
  }
}

### cancel_list
Cancela la lista (soft delete). Estado irreversible.

Payload:
- list_id: string (UUID, requerido)

Ejemplo:
{
  "action": "cancel_list",
  "payload": {
    "list_id": "uuid-de-la-lista"
  }
}

### update_quick_memory
Actualiza la memoria rápida de la vía rápida con los datos más recientes de la base de datos.
Usá esta acción después de crear, modificar o eliminar datos relevantes (tareas, objetivos, listas, eventos).
No requiere payload.

Ejemplo:
{
  "action": "update_quick_memory",
  "payload": {}
}
`.trim();
