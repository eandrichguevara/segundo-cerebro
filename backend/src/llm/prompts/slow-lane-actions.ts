export const SLOW_LANE_ACTIONS_PROMPT = `
## Acciones disponibles

### respond
Respondé al usuario con texto natural usando la información del contexto (tareas, listas, objetivos, memorias).
Usá esta acción para preguntas, resúmenes, cruces de datos e insights.

Payload:
- text: string (requerido, respuesta natural en español)

Ejemplo:
{
  "action": "respond",
  "payload": {
    "text": "Tenés 3 tareas pendientes: revisar el presupuesto (alta), comprar leche (media) y llamar a tu mamá (baja)."
  }
}

### query_list
Consulta el contenido de una lista existente sin modificarla.
El sistema busca la lista por nombre (coincidencia parcial, sin distinguir mayúsculas).

Payload:
- list_title: string (requerido, nombre o parte del nombre de la lista)

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
`.trim();
