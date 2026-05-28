export function formatActionResponse(
	action: string,
	ok: boolean,
	payload: Record<string, unknown>,
): string {
	if (!ok) {
		const message = (payload.message as string) ?? "algo salió mal";
		return message;
	}

	switch (action) {
		case "respond": {
			const text = payload.text as string | undefined;
			return text ?? "Entendido";
		}

		case "query_list": {
			const title = payload.title as string | undefined;
			const items = payload.items as
				| Array<{ content: string; quantity?: string }>
				| undefined;
			const lists = payload.lists as
				| Array<{
						id: string;
						title: string;
						type: string;
						items: Array<{
							content: string;
							quantity?: string;
							checked?: boolean;
						}>;
				  }>
				| undefined;
			if (lists && !title) {
				if (lists.length === 1) {
					const l = lists[0];
					if (!l) return "Lista vacía";
					const itemText = l.items
						.map((i) => {
							const checked = i.checked;
							const prefix = checked ? "✓ " : "";
							return i.quantity
								? `${prefix}${i.content} (${i.quantity})`
								: `${prefix}${i.content}`;
						})
						.join(", ");
					return `Tenés una lista: "${l.title}" con: ${itemText}`;
				}
				const listNames = lists
					.map((l) => `"${l.title}" (${l.type})`)
					.join(", ");
				return `Tenés ${lists.length} listas: ${listNames}`;
			}
			if (!title || !items) {
				return "No encontré información de la lista";
			}
			const itemText = items
				.map((i) => {
					const checked = (i as Record<string, unknown>).checked;
					const prefix = checked ? "✓ " : "";
					return i.quantity
						? `${prefix}${i.content} (${i.quantity})`
						: `${prefix}${i.content}`;
				})
				.join(", ");
			return `En la lista "${title}" tenés: ${itemText}`;
		}

		case "create_list": {
			const title = payload.title as string | undefined;
			const items = payload.items as Array<unknown> | undefined;
			const count = items?.length ?? 0;
			return count > 0
				? `Creé la lista "${title}" con ${count} items`
				: `Creé la lista "${title}"`;
		}

		case "add_list_items": {
			const items = payload.items as Array<{ content: string }> | undefined;
			const count = items?.length ?? 0;
			return `Agregué ${count} item${count !== 1 ? "s" : ""} a la lista`;
		}

		case "check_list_item":
			return "El item fue marcado como completado";

		case "uncheck_list_item":
			return "Desmarqué el item de la lista";

		case "complete_list":
			return "La lista fue marcada como completada";

		case "cancel_list":
			return "La lista fue cancelada";

		case "create_task": {
			const title = payload.title as string | undefined;
			const priority = payload.priority as string | undefined;
			const parts = [title ? `"${title}"` : "la tarea"];
			if (priority) parts.push(`prioridad ${priority}`);
			return `Creé la tarea ${parts.join(" con ")}`;
		}

		case "start_task":
			return "La tarea fue iniciada";

		case "update_task": {
			const title = payload.title as string | undefined;
			return title
				? `Actualicé la tarea "${title}"`
				: "La tarea fue actualizada";
		}

		case "complete_task": {
			const title = payload.title as string | undefined;
			return title
				? `Marcé "${title}" como completada`
				: "La tarea fue marcada como completada";
		}

		case "cancel_task":
			return "La tarea fue cancelada";

		case "postpone_task": {
			const dueDate = payload.due_date as string | undefined;
			if (dueDate) {
				const date = new Date(dueDate);
				const formatted = date.toLocaleDateString("es-AR", {
					day: "numeric",
					month: "long",
				});
				return `La tarea fue pospuesta para el ${formatted}`;
			}
			return "La tarea fue pospuesta";
		}

		case "create_objective": {
			const title = payload.title as string | undefined;
			return title ? `Creé el objetivo "${title}"` : "Creé el objetivo";
		}

		case "update_objective": {
			const title = payload.title as string | undefined;
			return title
				? `Actualicé el objetivo "${title}"`
				: "El objetivo fue actualizado";
		}

		case "complete_objective":
			return "El objetivo fue marcado como completado";

		case "cancel_objective": {
			const count = payload.cancelled_tasks as number | undefined;
			return count && count > 0
				? `El objetivo fue cancelado junto con ${count} tarea${count !== 1 ? "s" : ""} pendientes`
				: "El objetivo fue cancelado";
		}

		case "pause_objective":
			return "El objetivo fue pausado";

		case "resume_objective":
			return "El objetivo fue reactivado";

		case "store_memory":
			return "Entendido, lo tengo en cuenta";

		case "create_event": {
			const title = payload.title as string | undefined;
			const hasRecurrence = payload.recurrence_rule !== undefined;
			return title
				? `Creé el evento "${title}"${hasRecurrence ? " con recurrencia" : ""}`
				: `Creé el evento${hasRecurrence ? " con recurrencia" : ""}`;
		}

		case "update_event": {
			const title = payload.title as string | undefined;
			return title
				? `Actualicé el evento "${title}"`
				: "El evento fue actualizado";
		}

		case "delete_event":
			return "El evento fue cancelado";

		case "query_events": {
			const events = payload.events as
				| Array<{ title: string; start_time: string }>
				| undefined;
			const recurring = payload.recurring_events as
				| Array<{ title: string }>
				| undefined;
			if (
				(!events || events.length === 0) &&
				(!recurring || recurring.length === 0)
			) {
				return "No tenés eventos en ese período";
			}
			const eventList = events?.length
				? events.map((e) => `"${e.title}"`).join(", ")
				: "";
			const recurringList = recurring?.length
				? `${recurring.length} evento${recurring.length !== 1 ? "s" : ""} recurrente${recurring.length !== 1 ? "s" : ""}`
				: "";
			const parts = [eventList, recurringList].filter(Boolean);
			return `Encontré ${parts.join(" y ")}`;
		}

		case "move_event_instance": {
			const title = payload.title as string | undefined;
			return title
				? `Moví "${title}" a la nueva fecha`
				: "La instancia del evento fue movida";
		}

		case "update_recurrence_rule":
			return "La recurrencia del evento fue actualizada";

		case "link_task_event": {
			const linked = payload.linked as number | undefined;
			return linked
				? `Vinculé ${linked} tarea${linked !== 1 ? "s" : ""} con ${linked} evento${linked !== 1 ? "s" : ""}`
				: "No se pudieron vincular tareas y eventos";
		}

		case "unlink_task_event": {
			const unlinked = payload.unlinked as number | undefined;
			return unlinked
				? `Desvinculé ${unlinked} tarea${unlinked !== 1 ? "s" : ""} de ${unlinked} evento${unlinked !== 1 ? "s" : ""}`
				: "No se pudieron desvincular tareas y eventos";
		}

		default:
			return "Listo, ya está hecho";
	}
}
