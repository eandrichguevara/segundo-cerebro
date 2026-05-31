import { logger } from "../config/logger.js";
import * as entityLinkRepository from "../db/repositories/entity-link-repository.js";
import * as eventRepository from "../db/repositories/event-repository.js";
import * as ideaRepository from "../db/repositories/idea-repository.js";
import * as listRepository from "../db/repositories/list-repository.js";
import * as memoryRepository from "../db/repositories/memory-repository.js";
import * as objectiveRepository from "../db/repositories/objective-repository.js";
import * as projectRepository from "../db/repositories/project-repository.js";
import * as taskRepository from "../db/repositories/task-repository.js";
import { validateLink } from "../domain/entity-link.js";
import {
	EventStatus,
	transitionStatus as transitionEventStatus,
	validateCreateEvent,
	validateRecurrenceRule,
} from "../domain/event.js";
import {
	IdeaStatus,
	transitionStatus as transitionIdeaStatus,
} from "../domain/idea.js";
import type { ListError, ListItem } from "../domain/list.js";
import {
	ListStatus,
	transitionStatus,
	validateCompleteList,
	validateCreateList,
	validateItemIndex,
} from "../domain/list.js";
import {
	ObjectiveStatus,
	transitionStatus as transitionObjectiveStatus,
} from "../domain/objective.js";
import {
	ProjectStatus,
	transitionStatus as transitionProjectStatus,
} from "../domain/project.js";
import { update as updateQuickMemory } from "../domain/quick-memory.js";
import {
	TaskStatus,
	transitionStatus as transitionTaskStatus,
} from "../domain/task.js";
import { generateEmbedding } from "../llm/embeddings.js";
import type { DisplayEntity } from "../types/display.js";
import type { Result } from "../types/result.js";

type ActionResult = {
	ok: boolean;
	action: string;
	correlationId: string;
	payload: Record<string, unknown>;
};

function actionResult(
	ok: boolean,
	action: string,
	correlationId: string,
	payload: Record<string, unknown>,
): ActionResult {
	return { ok, action, correlationId, payload };
}

function errorPayload(error: string, message: string): Record<string, unknown> {
	return { error, message };
}

export async function handleRespond(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const messages = payload.messages as Array<unknown> | undefined;
	if (!Array.isArray(messages) || messages.length === 0) {
		return actionResult(false, "respond", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "messages es requerido (array de strings)",
		});
	}
	const trimmed = messages.map((m) => String(m).trim()).filter(Boolean);
	if (trimmed.length === 0) {
		return actionResult(false, "respond", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "messages debe contener al menos un string no vacío",
		});
	}

	const result: Record<string, unknown> = { messages: trimmed };

	const display = payload.display as Array<Record<string, unknown>> | undefined;
	if (Array.isArray(display) && display.length > 0) {
		result.display = display;
	}

	return actionResult(true, "respond", correlationId, result);
}

export async function handleQueryList(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const listTitle = (payload.list_title as string | undefined)?.trim();

	if (!listTitle || listTitle.length === 0) {
		const allLists = await listRepository.getAllActive();
		if (allLists.length === 0) {
			return actionResult(false, "query_list", correlationId, {
				error: "LIST_NOT_FOUND",
				message: "No tenés listas activas",
			});
		}
		return actionResult(true, "query_list", correlationId, {
			lists: (allLists as never[]).map((l) => ({
				id: (l as { id: string }).id,
				title: (l as { title: string }).title,
				type: (l as { type: string }).type,
				items: listRepository.getItems(l as never),
			})),
		});
	}

	try {
		const exact = await listRepository.findActiveByExactTitle(listTitle);
		if (exact) {
			return actionResult(true, "query_list", correlationId, {
				id: exact.id,
				title: exact.title,
				type: exact.type,
				items: listRepository.getItems(exact),
			});
		}

		const matches = await listRepository.findActiveByTitle(listTitle);
		if (matches.length === 0) {
			return actionResult(false, "query_list", correlationId, {
				error: "LIST_NOT_FOUND",
				message: `No encontré una lista activa con el nombre "${listTitle}"`,
			});
		}

		if (matches.length === 1) {
			const match = matches[0];
			if (!match) {
				return actionResult(false, "query_list", correlationId, {
					error: "LIST_NOT_FOUND",
					message: "No se pudo obtener la lista",
				});
			}
			return actionResult(true, "query_list", correlationId, {
				id: match.id,
				title: match.title,
				type: match.type,
				items: listRepository.getItems(match as never),
			});
		}

		return actionResult(false, "query_list", correlationId, {
			error: "AMBIGUOUS_MATCH",
			message: `Encontré varias listas que coinciden con "${listTitle}": ${matches.map((l) => l.title).join(", ")}. Sé más específico.`,
			matches: matches.map((l) => ({ id: l.id, title: l.title, type: l.type })),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error querying list");
		return actionResult(false, "query_list", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al consultar la lista",
		});
	}
}

export async function handleCreateList(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const validation = validateCreateList({
		title: payload.title as string | undefined,
	});
	if (!validation.ok) {
		return actionResult(false, "create_list", correlationId, {
			error: validation.error,
			message: "El título es requerido",
		});
	}

	const items =
		(
			payload.items as Array<{ content: string; quantity?: string }> | undefined
		)?.map((i) => ({
			content: i.content,
			quantity: i.quantity,
			checked: false,
		})) ?? [];

	try {
		const list = await listRepository.createList({
			title: validation.value.title,
			type: (payload.type as string) ?? "general",
			description: payload.description as string | undefined,
			items,
		});

		return actionResult(true, "create_list", correlationId, {
			id: list.id,
			title: list.title,
			type: list.type,
			status: list.status,
			items: listRepository.getItems(list),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error creating list");
		return actionResult(false, "create_list", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al crear la lista",
		});
	}
}

export async function handleAddListItems(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const listId = payload.list_id as string | undefined;
	if (!listId) {
		return actionResult(false, "add_list_items", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "list_id es requerido",
		});
	}

	const newItems = payload.items as
		| Array<{ content: string; quantity?: string }>
		| undefined;
	if (!newItems || newItems.length === 0) {
		return actionResult(false, "add_list_items", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "items es requerido y debe contener al menos un elemento",
		});
	}

	try {
		const existing = await listRepository.getListById(listId);
		if (!existing) {
			return actionResult(false, "add_list_items", correlationId, {
				error: "LIST_NOT_FOUND",
				message: "No existe una lista con el ID proporcionado",
			});
		}

		const currentItems = listRepository.getItems(existing);
		const itemsToAdd: ListItem[] = newItems.map((i) => ({
			content: i.content,
			quantity: i.quantity,
			checked: false,
		}));
		const updatedItems = [...currentItems, ...itemsToAdd];

		const list = await listRepository.updateList(listId, {
			items: updatedItems,
		});

		return actionResult(true, "add_list_items", correlationId, {
			id: list.id,
			items: listRepository.getItems(list),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error adding list items");
		return actionResult(false, "add_list_items", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al agregar items a la lista",
		});
	}
}

export async function handleCheckListItem(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleToggleListItem(payload, correlationId, true);
}

export async function handleUncheckListItem(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleToggleListItem(payload, correlationId, false);
}

async function handleToggleListItem(
	payload: Record<string, unknown>,
	correlationId: string,
	checked: boolean,
): Promise<ActionResult> {
	const action = checked ? "check_list_item" : "uncheck_list_item";
	const listId = payload.list_id as string | undefined;
	const itemIndex = payload.item_index as number | undefined;

	if (!listId) {
		return actionResult(false, action, correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "list_id es requerido",
		});
	}

	if (typeof itemIndex !== "number" || itemIndex < 0) {
		return actionResult(false, action, correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "item_index debe ser un número válido",
		});
	}

	try {
		const existing = await listRepository.getListById(listId);
		if (!existing) {
			return actionResult(false, action, correlationId, {
				error: "LIST_NOT_FOUND",
				message: "No existe una lista con el ID proporcionado",
			});
		}

		const currentItems = listRepository.getItems(existing);
		const indexValidation = validateItemIndex(currentItems, itemIndex);
		if (!indexValidation.ok) {
			return actionResult(false, action, correlationId, {
				error: indexValidation.error,
				message: `Índice ${itemIndex} inválido para la lista`,
			});
		}

		const updatedItems = currentItems.map((item, i) =>
			i === itemIndex ? { ...item, checked } : item,
		);

		const list = await listRepository.updateList(listId, {
			items: updatedItems,
		});

		return actionResult(true, action, correlationId, {
			id: list.id,
			items: listRepository.getItems(list),
		});
	} catch (error) {
		logger.error(
			{ error, correlationId },
			`Error toggling list item: ${action}`,
		);
		return actionResult(false, action, correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al modificar el item de la lista",
		});
	}
}

async function handleListStatusTransition(
	action: string,
	payload: Record<string, unknown>,
	correlationId: string,
	targetStatus: ListStatus,
): Promise<ActionResult> {
	const listId = payload.list_id as string | undefined;
	if (!listId) {
		return actionResult(false, action, correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "list_id es requerido",
		});
	}

	try {
		const existing = await listRepository.getListById(listId);
		if (!existing) {
			return actionResult(false, action, correlationId, {
				error: "LIST_NOT_FOUND",
				message: "No existe una lista con el ID proporcionado",
			});
		}

		const currentStatus = existing.status.toLowerCase() as ListStatus;
		const transition = transitionStatus(currentStatus, targetStatus);
		if (!transition.ok) {
			return actionResult(false, action, correlationId, {
				error: transition.error,
				message: `No se puede pasar de ${currentStatus} a ${targetStatus}`,
			});
		}

		const cancelledAt =
			targetStatus === ListStatus.CANCELLED ? new Date() : undefined;

		if (targetStatus === ListStatus.COMPLETED) {
			const items = listRepository.getItems(existing);
			const validation = validateCompleteList(items);
			if (!validation.ok) {
				return actionResult(false, action, correlationId, {
					error: validation.error,
					message: "La lista tiene items sin completar",
				});
			}
		}

		const list = await listRepository.transitionListStatus(
			listId,
			targetStatus,
			cancelledAt,
		);

		return actionResult(true, action, correlationId, {
			id: list.id,
			status: list.status,
			items: listRepository.getItems(list),
		});
	} catch (error) {
		logger.error(
			{ error, correlationId },
			`Error transitioning list: ${action}`,
		);
		return actionResult(false, action, correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al cambiar el estado de la lista",
		});
	}
}

export async function handleCompleteList(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleListStatusTransition(
		"complete_list",
		payload,
		correlationId,
		ListStatus.COMPLETED,
	);
}

export async function handleCancelList(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleListStatusTransition(
		"cancel_list",
		payload,
		correlationId,
		ListStatus.CANCELLED,
	);
}

export async function handleCreateTask(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const title = payload.title as string | undefined;
	if (!title || title.trim().length === 0) {
		return actionResult(false, "create_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "El título es requerido",
		});
	}

	try {
		const task = await taskRepository.createTask({
			title: title.trim(),
			description: payload.description as string | undefined,
			dueDate: payload.due_date as string | undefined,
			objectiveId: payload.objective_id as string | undefined,
			priority: payload.priority as string | undefined,
			context: payload.context as Record<string, unknown> | undefined,
		});

		return actionResult(true, "create_task", correlationId, {
			id: task.id,
			title: task.title,
			status: task.status,
			...(task.dueDate ? { due_date: task.dueDate.toISOString() } : {}),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error creating task");
		return actionResult(false, "create_task", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al crear la tarea",
		});
	}
}

export async function handleStartTask(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const taskId = payload.task_id as string | undefined;
	if (!taskId) {
		return actionResult(false, "start_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "task_id es requerido",
		});
	}

	try {
		const task = await taskRepository.getTaskById(taskId);
		if (!task) {
			return actionResult(false, "start_task", correlationId, {
				error: "TASK_NOT_FOUND",
				message: "No existe una tarea con el ID proporcionado",
			});
		}

		const transition = transitionTaskStatus(
			task.status as TaskStatus,
			TaskStatus.IN_PROGRESS,
		);
		if (!transition.ok) {
			return actionResult(false, "start_task", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede iniciar una tarea en estado ${task.status}`,
			});
		}

		const updated = await taskRepository.transitionTaskStatus(
			taskId,
			TaskStatus.IN_PROGRESS,
		);
		return actionResult(true, "start_task", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error starting task");
		return actionResult(false, "start_task", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al iniciar la tarea",
		});
	}
}

export async function handleUpdateTask(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const taskId = payload.task_id as string | undefined;
	if (!taskId) {
		return actionResult(false, "update_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "task_id es requerido",
		});
	}

	try {
		const task = await taskRepository.getTaskById(taskId);
		if (!task) {
			return actionResult(false, "update_task", correlationId, {
				error: "TASK_NOT_FOUND",
				message: "No existe una tarea con el ID proporcionado",
			});
		}

		if (task.status === TaskStatus.COMPLETED) {
			return actionResult(false, "update_task", correlationId, {
				error: "CANNOT_MODIFY_COMPLETED",
				message: "No se puede modificar una tarea completada",
			});
		}
		if (task.status === TaskStatus.CANCELLED) {
			return actionResult(false, "update_task", correlationId, {
				error: "CANNOT_MODIFY_CANCELLED",
				message: "No se puede modificar una tarea cancelada",
			});
		}

		const updated = await taskRepository.updateTask(taskId, {
			title: payload.title as string | undefined,
			description: payload.description as string | undefined,
			dueDate: payload.due_date as string | undefined,
			objectiveId: payload.objective_id as string | undefined,
			priority: payload.priority as string | undefined,
			context: payload.context as Record<string, unknown> | undefined,
		});

		return actionResult(true, "update_task", correlationId, {
			id: updated.id,
			title: updated.title,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating task");
		return actionResult(false, "update_task", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar la tarea",
		});
	}
}

export async function handleCompleteTask(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const taskId = payload.task_id as string | undefined;
	if (!taskId) {
		return actionResult(false, "complete_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "task_id es requerido",
		});
	}

	try {
		const task = await taskRepository.getTaskById(taskId);
		if (!task) {
			return actionResult(false, "complete_task", correlationId, {
				error: "TASK_NOT_FOUND",
				message: "No existe una tarea con el ID proporcionado",
			});
		}

		const transition = transitionTaskStatus(
			task.status as TaskStatus,
			TaskStatus.COMPLETED,
		);
		if (!transition.ok) {
			return actionResult(false, "complete_task", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede completar una tarea en estado ${task.status}`,
			});
		}

		const updated = await taskRepository.transitionTaskStatus(
			taskId,
			TaskStatus.COMPLETED,
		);
		return actionResult(true, "complete_task", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error completing task");
		return actionResult(false, "complete_task", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al completar la tarea",
		});
	}
}

export async function handleCancelTask(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const taskId = payload.task_id as string | undefined;
	if (!taskId) {
		return actionResult(false, "cancel_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "task_id es requerido",
		});
	}

	try {
		const task = await taskRepository.getTaskById(taskId);
		if (!task) {
			return actionResult(false, "cancel_task", correlationId, {
				error: "TASK_NOT_FOUND",
				message: "No existe una tarea con el ID proporcionado",
			});
		}

		const transition = transitionTaskStatus(
			task.status as TaskStatus,
			TaskStatus.CANCELLED,
		);
		if (!transition.ok) {
			return actionResult(false, "cancel_task", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede cancelar una tarea en estado ${task.status}`,
			});
		}

		const updated = await taskRepository.transitionTaskStatus(
			taskId,
			TaskStatus.CANCELLED,
			new Date(),
		);
		return actionResult(true, "cancel_task", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error cancelling task");
		return actionResult(false, "cancel_task", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al cancelar la tarea",
		});
	}
}

export async function handlePostponeTask(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const taskId = payload.task_id as string | undefined;
	const dueDate = payload.due_date as string | undefined;

	if (!taskId) {
		return actionResult(false, "postpone_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "task_id es requerido",
		});
	}
	if (!dueDate) {
		return actionResult(false, "postpone_task", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "due_date es requerido",
		});
	}

	try {
		const task = await taskRepository.getTaskById(taskId);
		if (!task) {
			return actionResult(false, "postpone_task", correlationId, {
				error: "TASK_NOT_FOUND",
				message: "No existe una tarea con el ID proporcionado",
			});
		}

		const transition = transitionTaskStatus(
			task.status as TaskStatus,
			TaskStatus.POSTPONED,
		);
		if (!transition.ok) {
			return actionResult(false, "postpone_task", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede posponer una tarea en estado ${task.status}`,
			});
		}

		await taskRepository.updateTask(taskId, { dueDate });
		const updated = await taskRepository.transitionTaskStatus(
			taskId,
			TaskStatus.POSTPONED,
		);
		return actionResult(true, "postpone_task", correlationId, {
			id: updated.id,
			status: updated.status,
			due_date: dueDate,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error postponing task");
		return actionResult(false, "postpone_task", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al posponer la tarea",
		});
	}
}

export async function handleCreateObjective(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const title = payload.title as string | undefined;
	if (!title || title.trim().length === 0) {
		return actionResult(false, "create_objective", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "El título es requerido",
		});
	}

	try {
		const objective = await objectiveRepository.createObjective({
			title: title.trim(),
			description: payload.description as string | undefined,
			deadline: payload.deadline as string | undefined,
		});

		return actionResult(true, "create_objective", correlationId, {
			id: objective.id,
			title: objective.title,
			status: objective.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error creating objective");
		return actionResult(false, "create_objective", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al crear el objetivo",
		});
	}
}

export async function handleUpdateObjective(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const objectiveId = payload.objective_id as string | undefined;
	if (!objectiveId) {
		return actionResult(false, "update_objective", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "objective_id es requerido",
		});
	}

	try {
		const objective = await objectiveRepository.getObjectiveById(objectiveId);
		if (!objective) {
			return actionResult(false, "update_objective", correlationId, {
				error: "OBJECTIVE_NOT_FOUND",
				message: "No existe un objetivo con el ID proporcionado",
			});
		}

		const updated = await objectiveRepository.updateObjective(objectiveId, {
			title: payload.title as string | undefined,
			description: payload.description as string | undefined,
			deadline: payload.deadline as string | undefined,
		});

		return actionResult(true, "update_objective", correlationId, {
			id: updated.id,
			title: updated.title,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating objective");
		return actionResult(false, "update_objective", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar el objetivo",
		});
	}
}

export async function handleCompleteObjective(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const objectiveId = payload.objective_id as string | undefined;
	if (!objectiveId) {
		return actionResult(false, "complete_objective", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "objective_id es requerido",
		});
	}

	try {
		const objective = await objectiveRepository.getObjectiveById(objectiveId);
		if (!objective) {
			return actionResult(false, "complete_objective", correlationId, {
				error: "OBJECTIVE_NOT_FOUND",
				message: "No existe un objetivo con el ID proporcionado",
			});
		}

		const transition = transitionObjectiveStatus(
			objective.status as ObjectiveStatus,
			ObjectiveStatus.COMPLETED,
		);
		if (!transition.ok) {
			return actionResult(false, "complete_objective", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede completar un objetivo en estado ${objective.status}`,
			});
		}

		const tasks = await objectiveRepository.getTasksByObjective(objectiveId);
		const pendingTasks = tasks.filter(
			(t: { status: string }) =>
				t.status === "pending" || t.status === "in_progress",
		);
		if (pendingTasks.length > 0) {
			return actionResult(false, "complete_objective", correlationId, {
				error: "OBJECTIVE_HAS_PENDING_TASKS",
				message:
					"El objetivo tiene tareas pendientes que deben completarse o cancelarse primero",
			});
		}

		const updated = await objectiveRepository.transitionObjectiveStatus(
			objectiveId,
			ObjectiveStatus.COMPLETED,
		);
		return actionResult(true, "complete_objective", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error completing objective");
		return actionResult(false, "complete_objective", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al completar el objetivo",
		});
	}
}

export async function handleCancelObjective(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const objectiveId = payload.objective_id as string | undefined;
	if (!objectiveId) {
		return actionResult(false, "cancel_objective", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "objective_id es requerido",
		});
	}

	try {
		const objective = await objectiveRepository.getObjectiveById(objectiveId);
		if (!objective) {
			return actionResult(false, "cancel_objective", correlationId, {
				error: "OBJECTIVE_NOT_FOUND",
				message: "No existe un objetivo con el ID proporcionado",
			});
		}

		const transition = transitionObjectiveStatus(
			objective.status as ObjectiveStatus,
			ObjectiveStatus.CANCELLED,
		);
		if (!transition.ok) {
			return actionResult(false, "cancel_objective", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede cancelar un objetivo en estado ${objective.status}`,
			});
		}

		const tasks = await objectiveRepository.getTasksByObjective(objectiveId);
		const cancellableTasks = tasks.filter(
			(t: { status: string }) =>
				t.status === "pending" ||
				t.status === "in_progress" ||
				t.status === "postponed",
		);
		for (const task of cancellableTasks) {
			await taskRepository
				.transitionTaskStatus(task.id, TaskStatus.CANCELLED, new Date())
				.catch((error) => {
					logger.error(
						{ error, taskId: task.id, correlationId },
						"Error cancelling task cascade",
					);
				});
		}

		const updated = await objectiveRepository.transitionObjectiveStatus(
			objectiveId,
			ObjectiveStatus.CANCELLED,
			new Date(),
		);
		return actionResult(true, "cancel_objective", correlationId, {
			id: updated.id,
			status: updated.status,
			cancelled_tasks: cancellableTasks.length,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error cancelling objective");
		return actionResult(false, "cancel_objective", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al cancelar el objetivo",
		});
	}
}

export async function handlePauseObjective(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const objectiveId = payload.objective_id as string | undefined;
	if (!objectiveId) {
		return actionResult(false, "pause_objective", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "objective_id es requerido",
		});
	}

	try {
		const objective = await objectiveRepository.getObjectiveById(objectiveId);
		if (!objective) {
			return actionResult(false, "pause_objective", correlationId, {
				error: "OBJECTIVE_NOT_FOUND",
				message: "No existe un objetivo con el ID proporcionado",
			});
		}

		const transition = transitionObjectiveStatus(
			objective.status as ObjectiveStatus,
			ObjectiveStatus.PAUSED,
		);
		if (!transition.ok) {
			return actionResult(false, "pause_objective", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede pausar un objetivo en estado ${objective.status}`,
			});
		}

		const updated = await objectiveRepository.transitionObjectiveStatus(
			objectiveId,
			ObjectiveStatus.PAUSED,
		);
		return actionResult(true, "pause_objective", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error pausing objective");
		return actionResult(false, "pause_objective", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al pausar el objetivo",
		});
	}
}

export async function handleResumeObjective(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const objectiveId = payload.objective_id as string | undefined;
	if (!objectiveId) {
		return actionResult(false, "resume_objective", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "objective_id es requerido",
		});
	}

	try {
		const objective = await objectiveRepository.getObjectiveById(objectiveId);
		if (!objective) {
			return actionResult(false, "resume_objective", correlationId, {
				error: "OBJECTIVE_NOT_FOUND",
				message: "No existe un objetivo con el ID proporcionado",
			});
		}

		const transition = transitionObjectiveStatus(
			objective.status as ObjectiveStatus,
			ObjectiveStatus.ACTIVE,
		);
		if (!transition.ok) {
			return actionResult(false, "resume_objective", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede reactivar un objetivo en estado ${objective.status}`,
			});
		}

		const updated = await objectiveRepository.transitionObjectiveStatus(
			objectiveId,
			ObjectiveStatus.ACTIVE,
		);
		return actionResult(true, "resume_objective", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error resuming objective");
		return actionResult(false, "resume_objective", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al reactivar el objetivo",
		});
	}
}

export async function handleStoreMemory(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const content = payload.content as string | undefined;
	if (!content || content.trim().length === 0) {
		return actionResult(false, "store_memory", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "content es requerido",
		});
	}

	try {
		const trimmedContent = content.trim();
		const embeddingResult = await generateEmbedding(trimmedContent);

		if (!embeddingResult.ok) {
			logger.warn(
				{ correlationId },
				"Embedding generation failed, storing memory without vector",
			);
		}

		const memory = await memoryRepository.createMemory({
			content: trimmedContent,
			embedding: embeddingResult.ok ? embeddingResult.value : undefined,
			metadata: payload.metadata as Record<string, unknown> | undefined,
		});

		if (!memory) {
			return actionResult(false, "store_memory", correlationId, {
				error: "INTERNAL_ERROR",
				message: "Error al almacenar la memoria",
			});
		}

		return actionResult(true, "store_memory", correlationId, {
			id: memory.id,
			content: memory.content,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error storing memory");
		return actionResult(false, "store_memory", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al almacenar la memoria",
		});
	}
}

export async function handleCreateEvent(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const validation = validateCreateEvent({
		title: payload.title as string | undefined,
		startTime: payload.start_time as string | undefined,
	});
	if (!validation.ok) {
		return actionResult(false, "create_event", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "El título y la fecha de inicio son requeridos",
		});
	}

	let validatedRule: Record<string, unknown> | undefined;
	if (payload.recurrence_rule) {
		const ruleValidation = validateRecurrenceRule(payload.recurrence_rule);
		if (!ruleValidation.ok) {
			return actionResult(false, "create_event", correlationId, {
				error: "INVALID_RECURRENCE_RULE",
				message: "La regla de recurrencia no es válida",
			});
		}
		validatedRule = ruleValidation.value as unknown as Record<string, unknown>;
	}

	try {
		const event = await eventRepository.createEvent({
			title: validation.value.title,
			description: payload.description as string | undefined,
			location: payload.location as string | undefined,
			category: payload.category as string | undefined,
			startTime: validation.value.startTime,
			endTime: payload.end_time as string | undefined,
			recurrenceRule: validatedRule,
		});

		const result: Record<string, unknown> = {
			id: event.id,
			title: event.title,
			start_time: event.startTime.toISOString(),
			status: event.status,
		};
		if (event.recurrenceRule) result.recurrence_rule = event.recurrenceRule;
		if (event.endTime) result.end_time = event.endTime.toISOString();

		return actionResult(true, "create_event", correlationId, result);
	} catch (error) {
		logger.error({ error, correlationId }, "Error creating event");
		return actionResult(false, "create_event", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al crear el evento",
		});
	}
}

export async function handleUpdateEvent(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const eventId = payload.event_id as string | undefined;
	if (!eventId) {
		return actionResult(false, "update_event", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "event_id es requerido",
		});
	}

	try {
		const event = await eventRepository.getEventById(eventId);
		if (!event) {
			return actionResult(false, "update_event", correlationId, {
				error: "EVENT_NOT_FOUND",
				message: "No existe un evento con el ID proporcionado",
			});
		}

		const updated = await eventRepository.updateEvent(eventId, {
			title: payload.title as string | undefined,
			description: payload.description as string | null | undefined,
			location: payload.location as string | null | undefined,
			category: payload.category as string | null | undefined,
			startTime: payload.start_time as string | undefined,
			endTime: payload.end_time as string | null | undefined,
		});

		return actionResult(true, "update_event", correlationId, {
			id: updated.id,
			title: updated.title,
			start_time: updated.startTime.toISOString(),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating event");
		return actionResult(false, "update_event", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar el evento",
		});
	}
}

export async function handleDeleteEvent(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const eventId = payload.event_id as string | undefined;
	if (!eventId) {
		return actionResult(false, "delete_event", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "event_id es requerido",
		});
	}

	try {
		const event = await eventRepository.getEventById(eventId);
		if (!event) {
			return actionResult(false, "delete_event", correlationId, {
				error: "EVENT_NOT_FOUND",
				message: "No existe un evento con el ID proporcionado",
			});
		}

		const transition = transitionEventStatus(
			event.status as EventStatus,
			EventStatus.CANCELLED,
		);
		if (!transition.ok) {
			return actionResult(false, "delete_event", correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: "No se puede cancelar el evento en su estado actual",
			});
		}

		const updated = await eventRepository.transitionEventStatus(
			eventId,
			EventStatus.CANCELLED,
			new Date(),
		);

		return actionResult(true, "delete_event", correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error deleting event");
		return actionResult(false, "delete_event", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al cancelar el evento",
		});
	}
}

export async function handleQueryEvents(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const startDate =
		(payload.start_date as string | undefined) ?? new Date().toISOString();
	const endDate =
		(payload.end_date as string | undefined) ??
		new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

	try {
		const events = await eventRepository.getEventsByDateRange(
			new Date(startDate),
			new Date(endDate),
		);

		const recurringEvents = await eventRepository.getRecurringEvents();
		const allExceptions: Array<{
			parentId: string;
			event: Record<string, unknown>;
		}> = [];

		for (const re of recurringEvents) {
			const exceptions = await eventRepository.getEventExceptions(re.id);
			for (const exc of exceptions) {
				allExceptions.push({
					parentId: re.id,
					event: {
						id: exc.id,
						title: exc.title,
						start_time: exc.startTime.toISOString(),
						end_time: exc.endTime?.toISOString() ?? null,
						description: exc.description,
						location: exc.location,
						category: exc.category,
						is_exception: true,
						exception_date: exc.exceptionDate?.toISOString() ?? null,
					},
				});
			}
		}

		const result = {
			events: events.map((e) => ({
				id: e.id,
				title: e.title,
				start_time: e.startTime.toISOString(),
				end_time: e.endTime?.toISOString() ?? null,
				description: e.description,
				location: e.location,
				category: e.category,
				recurrence_rule: e.recurrenceRule,
				is_exception: e.isException,
			})),
			recurring_events: recurringEvents.map((e) => ({
				id: e.id,
				title: e.title,
				start_time: e.startTime.toISOString(),
				end_time: e.endTime?.toISOString() ?? null,
				recurrence_rule: e.recurrenceRule,
			})),
			exceptions: allExceptions,
		};

		return actionResult(true, "query_events", correlationId, result);
	} catch (error) {
		logger.error({ error, correlationId }, "Error querying events");
		return actionResult(false, "query_events", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al consultar eventos",
		});
	}
}

export async function handleMoveEventInstance(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const eventId = payload.event_id as string | undefined;
	const newStartTime = payload.new_start_time as string | undefined;
	const exceptionDate = payload.exception_date as string | undefined;

	if (!eventId) {
		return actionResult(false, "move_event_instance", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "event_id es requerido",
		});
	}
	if (!newStartTime) {
		return actionResult(false, "move_event_instance", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "new_start_time es requerido",
		});
	}

	try {
		const original = await eventRepository.getEventById(eventId);
		if (!original) {
			return actionResult(false, "move_event_instance", correlationId, {
				error: "EVENT_NOT_FOUND",
				message: "No existe un evento con el ID proporcionado",
			});
		}

		if (!original.recurrenceRule) {
			const updated = await eventRepository.updateEvent(eventId, {
				startTime: newStartTime,
				endTime: payload.new_end_time as string | null | undefined,
			});
			return actionResult(true, "move_event_instance", correlationId, {
				id: updated.id,
				title: updated.title,
				start_time: updated.startTime.toISOString(),
				message: "Evento único actualizado",
			});
		}

		const exception = await eventRepository.createEvent({
			title: original.title,
			description: original.description ?? undefined,
			location: original.location ?? undefined,
			category: original.category ?? undefined,
			startTime: newStartTime,
			endTime: payload.new_end_time as string | undefined,
			parentId: original.id,
			isException: true,
			exceptionDate: exceptionDate ?? original.startTime.toISOString(),
		});

		return actionResult(true, "move_event_instance", correlationId, {
			id: exception.id,
			parent_id: original.id,
			title: exception.title,
			start_time: exception.startTime.toISOString(),
			message: "Instancia movida como excepción del evento recurrente",
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error moving event instance");
		return actionResult(false, "move_event_instance", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al mover la instancia del evento",
		});
	}
}

export async function handleUpdateRecurrenceRule(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const eventId = payload.event_id as string | undefined;
	if (!eventId) {
		return actionResult(false, "update_recurrence_rule", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "event_id es requerido",
		});
	}

	try {
		const event = await eventRepository.getEventById(eventId);
		if (!event) {
			return actionResult(false, "update_recurrence_rule", correlationId, {
				error: "EVENT_NOT_FOUND",
				message: "No existe un evento con el ID proporcionado",
			});
		}

		const ruleValidation = validateRecurrenceRule(payload.recurrence_rule);
		if (!ruleValidation.ok) {
			return actionResult(false, "update_recurrence_rule", correlationId, {
				error: "INVALID_RECURRENCE_RULE",
				message: "La regla de recurrencia no es válida",
			});
		}

		const updated = await eventRepository.updateEvent(eventId, {
			recurrenceRule: ruleValidation.value as unknown as Record<
				string,
				unknown
			>,
		});

		return actionResult(true, "update_recurrence_rule", correlationId, {
			id: updated.id,
			recurrence_rule: updated.recurrenceRule,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating recurrence rule");
		return actionResult(false, "update_recurrence_rule", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar la regla de recurrencia",
		});
	}
}

// ── Project Handlers ──

export async function handleCreateProject(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const title = payload.title as string | undefined;
	if (!title || title.trim().length === 0) {
		return actionResult(false, "create_project", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "El título es requerido",
		});
	}

	try {
		const project = await projectRepository.createProject({
			title: title.trim(),
			description: payload.description as string | undefined,
			category: payload.category as string | undefined,
			deadline: payload.deadline as string | undefined,
		});

		return actionResult(true, "create_project", correlationId, {
			id: project.id,
			title: project.title,
			status: project.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error creating project");
		return actionResult(false, "create_project", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al crear el proyecto",
		});
	}
}

export async function handleUpdateProject(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const projectId = payload.project_id as string | undefined;
	if (!projectId) {
		return actionResult(false, "update_project", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "project_id es requerido",
		});
	}

	try {
		const project = await projectRepository.getProjectById(projectId);
		if (!project) {
			return actionResult(false, "update_project", correlationId, {
				error: "PROJECT_NOT_FOUND",
				message: "No existe un proyecto con el ID proporcionado",
			});
		}

		const updated = await projectRepository.updateProject(projectId, {
			title: payload.title as string | undefined,
			description: payload.description as string | undefined,
			category: payload.category as string | undefined,
			deadline: payload.deadline as string | undefined,
		});

		return actionResult(true, "update_project", correlationId, {
			id: updated.id,
			title: updated.title,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating project");
		return actionResult(false, "update_project", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar el proyecto",
		});
	}
}

async function handleProjectStatusTransition(
	action: string,
	payload: Record<string, unknown>,
	correlationId: string,
	targetStatus: ProjectStatus,
): Promise<ActionResult> {
	const projectId = payload.project_id as string | undefined;
	if (!projectId) {
		return actionResult(false, action, correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "project_id es requerido",
		});
	}

	try {
		const project = await projectRepository.getProjectById(projectId);
		if (!project) {
			return actionResult(false, action, correlationId, {
				error: "PROJECT_NOT_FOUND",
				message: "No existe un proyecto con el ID proporcionado",
			});
		}

		const transition = transitionProjectStatus(
			project.status as ProjectStatus,
			targetStatus,
		);
		if (!transition.ok) {
			return actionResult(false, action, correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede pasar de ${project.status} a ${targetStatus}`,
			});
		}

		const cancelledAt =
			targetStatus === ProjectStatus.CANCELLED ? new Date() : undefined;

		const updated = await projectRepository.transitionProjectStatus(
			projectId,
			targetStatus,
			cancelledAt,
		);

		return actionResult(true, action, correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, `Error transitioning project: ${action}`);
		return actionResult(false, action, correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al cambiar el estado del proyecto",
		});
	}
}

export async function handleCompleteProject(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleProjectStatusTransition("complete_project", payload, correlationId, ProjectStatus.COMPLETED);
}

export async function handleCancelProject(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleProjectStatusTransition("cancel_project", payload, correlationId, ProjectStatus.CANCELLED);
}

export async function handlePauseProject(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleProjectStatusTransition("pause_project", payload, correlationId, ProjectStatus.PAUSED);
}

export async function handleResumeProject(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleProjectStatusTransition("resume_project", payload, correlationId, ProjectStatus.ACTIVE);
}

// ── Idea Handlers ──

export async function handleCreateIdea(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const title = payload.title as string | undefined;
	if (!title || title.trim().length === 0) {
		return actionResult(false, "create_idea", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "El título es requerido",
		});
	}

	try {
		const idea = await ideaRepository.createIdea({
			title: title.trim(),
			description: payload.description as string | undefined,
			tags: payload.tags as string[] | undefined,
		});

		return actionResult(true, "create_idea", correlationId, {
			id: idea.id,
			title: idea.title,
			status: idea.status,
			tags: idea.tags,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error creating idea");
		return actionResult(false, "create_idea", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al crear la idea",
		});
	}
}

export async function handleUpdateIdea(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const ideaId = payload.idea_id as string | undefined;
	if (!ideaId) {
		return actionResult(false, "update_idea", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "idea_id es requerido",
		});
	}

	try {
		const idea = await ideaRepository.getIdeaById(ideaId);
		if (!idea) {
			return actionResult(false, "update_idea", correlationId, {
				error: "IDEA_NOT_FOUND",
				message: "No existe una idea con el ID proporcionado",
			});
		}

		const updated = await ideaRepository.updateIdea(ideaId, {
			title: payload.title as string | undefined,
			description: payload.description as string | undefined,
			tags: payload.tags as string[] | undefined,
		});

		return actionResult(true, "update_idea", correlationId, {
			id: updated.id,
			title: updated.title,
			status: updated.status,
			tags: updated.tags,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating idea");
		return actionResult(false, "update_idea", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar la idea",
		});
	}
}

async function handleIdeaStatusTransition(
	action: string,
	payload: Record<string, unknown>,
	correlationId: string,
	targetStatus: IdeaStatus,
): Promise<ActionResult> {
	const ideaId = payload.idea_id as string | undefined;
	if (!ideaId) {
		return actionResult(false, action, correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "idea_id es requerido",
		});
	}

	try {
		const idea = await ideaRepository.getIdeaById(ideaId);
		if (!idea) {
			return actionResult(false, action, correlationId, {
				error: "IDEA_NOT_FOUND",
				message: "No existe una idea con el ID proporcionado",
			});
		}

		const transition = transitionIdeaStatus(
			idea.status as IdeaStatus,
			targetStatus,
		);
		if (!transition.ok) {
			return actionResult(false, action, correlationId, {
				error: "INVALID_STATE_TRANSITION",
				message: `No se puede pasar de ${idea.status} a ${targetStatus}`,
			});
		}

		const updated = await ideaRepository.transitionIdeaStatus(ideaId, targetStatus);

		return actionResult(true, action, correlationId, {
			id: updated.id,
			status: updated.status,
		});
	} catch (error) {
		logger.error({ error, correlationId }, `Error transitioning idea: ${action}`);
		return actionResult(false, action, correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al cambiar el estado de la idea",
		});
	}
}

export async function handleEvaluateIdea(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleIdeaStatusTransition("evaluate_idea", payload, correlationId, IdeaStatus.EVALUATING);
}

export async function handleApproveIdea(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleIdeaStatusTransition("approve_idea", payload, correlationId, IdeaStatus.APPROVED);
}

export async function handleDiscardIdea(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleIdeaStatusTransition("discard_idea", payload, correlationId, IdeaStatus.DISCARDED);
}

export async function handleConvertIdea(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	return handleIdeaStatusTransition("convert_idea", payload, correlationId, IdeaStatus.CONVERTED);
}

// ── Entity Link Handlers ──

export async function handleLinkEntities(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const sourceType = payload.source_type as string | undefined;
	const sourceId = payload.source_id as string | undefined;
	const targetType = payload.target_type as string | undefined;
	const targetId = payload.target_id as string | undefined;

	if (!sourceType || !sourceId || !targetType || !targetId) {
		return actionResult(false, "link_entities", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "source_type, source_id, target_type y target_id son requeridos",
		});
	}

	const validation = validateLink({
		sourceType,
		sourceId,
		targetType,
		targetId,
		relation: payload.relation as string | undefined,
	});
	if (!validation.ok) {
		return actionResult(false, "link_entities", correlationId, {
			error: validation.error,
			message: `Enlace inválido: ${validation.error}`,
		});
	}

	try {
		const link = await entityLinkRepository.createLink({
			sourceType,
			sourceId,
			targetType,
			targetId,
			relation: payload.relation as string | undefined,
			note: payload.note as string | undefined,
		});

		return actionResult(true, "link_entities", correlationId, {
			id: link.id,
			source_type: link.sourceType,
			source_id: link.sourceId,
			target_type: link.targetType,
			target_id: link.targetId,
			relation: link.relation,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error linking entities");
		return actionResult(false, "link_entities", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al vincular las entidades",
		});
	}
}

export async function handleUnlinkEntities(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const sourceType = payload.source_type as string | undefined;
	const sourceId = payload.source_id as string | undefined;
	const targetType = payload.target_type as string | undefined;
	const targetId = payload.target_id as string | undefined;

	if (!sourceType || !sourceId || !targetType || !targetId) {
		return actionResult(false, "unlink_entities", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "source_type, source_id, target_type y target_id son requeridos",
		});
	}

	try {
		await entityLinkRepository.removeLink(sourceType, sourceId, targetType, targetId);
		return actionResult(true, "unlink_entities", correlationId, {
			unlinked: true,
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error unlinking entities");
		return actionResult(false, "unlink_entities", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al desvincular las entidades",
		});
	}
}

export async function handleQueryLinks(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	const entityType = payload.entity_type as string | undefined;
	const entityId = payload.entity_id as string | undefined;

	if (!entityType || !entityId) {
		return actionResult(false, "query_links", correlationId, {
			error: "MISSING_REQUIRED_FIELD",
			message: "entity_type y entity_id son requeridos",
		});
	}

	try {
		const links = await entityLinkRepository.getLinksFor(entityType, entityId);
		return actionResult(true, "query_links", correlationId, {
			links: links.map((l) => ({
				id: l.id,
				source_type: l.sourceType,
				source_id: l.sourceId,
				target_type: l.targetType,
				target_id: l.targetId,
				relation: l.relation,
				note: l.note,
			})),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error querying links");
		return actionResult(false, "query_links", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al consultar los enlaces",
		});
	}
}

function sortTasksByPriority(
	tasks: Array<{ priority?: string; dueDate?: Date | null }>,
): Array<{ priority?: string; dueDate?: Date | null }> {
	const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
	return [...tasks].sort((a, b) => {
		const pa = order[a.priority ?? "medium"] ?? 1;
		const pb = order[b.priority ?? "medium"] ?? 1;
		if (pa !== pb) return pa - pb;
		if (a.dueDate && b.dueDate)
			return a.dueDate.getTime() - b.dueDate.getTime();
		if (a.dueDate) return -1;
		if (b.dueDate) return 1;
		return 0;
	});
}

function buildWhoAmI(
	memories: Array<{ content: string; metadata?: unknown }>,
): string {
	if (memories.length === 0) return "Usuario";

	const preferences = memories.filter((m) => {
		const meta = m.metadata as Record<string, unknown> | null;
		return meta?.interaction_type === "preference_declaration";
	});

	if (preferences.length > 0) {
		return preferences
			.map((m) => m.content)
			.join(". ")
			.substring(0, 300);
	}

	const mostRecent = memories[0];
	if (mostRecent?.content && mostRecent.content.length < 200) {
		return mostRecent.content;
	}

	return "Usuario";
}

function buildRecentTopics(
	memories: Array<{ content: string }>,
	_lastTurns: Array<{ content: string }>,
): string {
	const words = memories.flatMap((m) => m.content.toLowerCase().split(/\s+/));
	const stopWords = new Set([
		"el",
		"la",
		"los",
		"las",
		"un",
		"una",
		"y",
		"o",
		"de",
		"del",
		"en",
		"con",
		"para",
		"por",
		"al",
		"que",
		"es",
		"se",
		"no",
		"lo",
		"como",
		"más",
		"pero",
		"sus",
		"le",
		"ya",
		"este",
		"entre",
		"porque",
		"cuando",
		"todo",
		"también",
		"fue",
		"era",
		"su",
		"me",
		"te",
		"mi",
		"tu",
		"él",
		"ella",
		"nos",
		"les",
		"las",
		"una",
		"dos",
		"muy",
		"sin",
		"sobre",
		"ha",
		"han",
		"has",
		"hay",
		"sea",
		"sido",
		"está",
		"están",
		"ser",
		"haber",
	]);

	const freq = new Map<string, number>();
	for (const w of words) {
		const cleaned = w.replace(/[^a-záéíóúüñ]/g, "");
		if (cleaned.length > 3 && !stopWords.has(cleaned)) {
			freq.set(cleaned, (freq.get(cleaned) ?? 0) + 1);
		}
	}

	const sorted = [...freq.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([word]) => word);

	return sorted.length > 0 ? sorted.join(", ") : "";
}

export async function initializeQuickMemory(): Promise<void> {
	try {
		const now = new Date();
		const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

		const [tasks, objectives, lists, events, memories, projects, ideas] = await Promise.all([
			taskRepository.getActiveTasks(),
			objectiveRepository.getActiveObjectives(),
			listRepository.getAllActive(),
			eventRepository.getEventsByDateRange(now, weekEnd),
			memoryRepository.getRecentMemories(5),
			projectRepository.getActiveProjects(),
			ideaRepository.getActiveIdeas(),
		]);

		const sortedTasks = sortTasksByPriority(
			tasks as Array<{ priority?: string; dueDate?: Date | null }>,
		);
		const typedTasks = tasks as Array<{
			title: string;
			priority?: string;
			dueDate?: Date | null;
			status?: string;
		}>;

		const topTasks = sortedTasks
			.slice(0, 5)
			.map(
				(t: { title?: string; priority?: string }) =>
					`${t.title ?? ""} (${t.priority ?? "medium"})`,
			);
		const topObjectives = (objectives as Array<{ title: string }>)
			.slice(0, 3)
			.map((o) => o.title);
		const topLists = (lists as Array<{ title: string }>)
			.slice(0, 2)
			.map((l) => l.title);
		const topEvents = (
			events as Array<{
				title: string;
				startTime: Date;
			}>
		)
			.slice(0, 5)
			.map((e) => {
				const date = e.startTime.toLocaleDateString("es-AR", {
					weekday: "short",
					day: "numeric",
					month: "short",
				});
				return `${e.title} (${date})`;
			});

		const topProjects = (projects as Array<{ title: string; status: string }>)
			.slice(0, 3)
			.map((p) => `${p.title} (${p.status})`);
		const topIdeas = (ideas as Array<{ title: string; status: string }>)
			.slice(0, 3)
			.map((i) => `${i.title} (${i.status})`);

		const todayStr = now.toDateString();
		const dueToday = typedTasks.filter((t) => {
			if (!t.dueDate) return false;
			return t.dueDate.toDateString() === todayStr;
		});

		const inProgress = typedTasks.filter((t) => t.status === "in_progress");

		const whoAmI = buildWhoAmI(
			memories as Array<{ content: string; metadata?: unknown }>,
		);

		const typedMemories = memories as Array<{ content: string }>;

		const recentTopics = buildRecentTopics(
			typedMemories.length > 0 ? typedMemories.slice(0, 3) : [],
			[],
		);

		updateQuickMemory({
			whoAmI,
			topData: {
				tasks: topTasks,
				objectives: topObjectives,
				lists: topLists,
				events: topEvents,
				projects: topProjects,
				ideas: topIdeas,
			},
			todayContext: {
				dueToday: dueToday.map((t) => t.title),
				inProgress: inProgress.map((t) => t.title),
				recentMentions:
					typedMemories.length > 0 && typedMemories[0] != null
						? typedMemories[0].content.substring(0, 150)
						: "",
			},
			recentTopics,
			updatedAt: now,
		});

		logger.info("Quick memory initialized");
	} catch (error) {
		logger.error({ error }, "Error initializing quick memory");
	}
}

export async function handleUpdateQuickMemory(
	payload: Record<string, unknown>,
	correlationId: string,
): Promise<ActionResult> {
	try {
		await initializeQuickMemory();
		return actionResult(true, "update_quick_memory", correlationId, {
			updated_at: new Date().toISOString(),
		});
	} catch (error) {
		logger.error({ error, correlationId }, "Error updating quick memory");
		return actionResult(false, "update_quick_memory", correlationId, {
			error: "INTERNAL_ERROR",
			message: "Error al actualizar la memoria rápida",
		});
	}
}

export type ActionHandler = (
	payload: Record<string, unknown>,
	correlationId: string,
) => Promise<ActionResult>;

const ACTION_ROUTER: Record<string, ActionHandler> = {
	respond: handleRespond,
	query_list: handleQueryList,
	update_quick_memory: handleUpdateQuickMemory,
	create_task: handleCreateTask,
	start_task: handleStartTask,
	update_task: handleUpdateTask,
	complete_task: handleCompleteTask,
	cancel_task: handleCancelTask,
	postpone_task: handlePostponeTask,
	create_objective: handleCreateObjective,
	update_objective: handleUpdateObjective,
	complete_objective: handleCompleteObjective,
	cancel_objective: handleCancelObjective,
	pause_objective: handlePauseObjective,
	resume_objective: handleResumeObjective,
	store_memory: handleStoreMemory,
	create_list: handleCreateList,
	add_list_items: handleAddListItems,
	check_list_item: handleCheckListItem,
	uncheck_list_item: handleUncheckListItem,
	complete_list: handleCompleteList,
	cancel_list: handleCancelList,
	create_event: handleCreateEvent,
	update_event: handleUpdateEvent,
	delete_event: handleDeleteEvent,
	query_events: handleQueryEvents,
	move_event_instance: handleMoveEventInstance,
	update_recurrence_rule: handleUpdateRecurrenceRule,
	create_project: handleCreateProject,
	update_project: handleUpdateProject,
	complete_project: handleCompleteProject,
	cancel_project: handleCancelProject,
	pause_project: handlePauseProject,
	resume_project: handleResumeProject,
	create_idea: handleCreateIdea,
	update_idea: handleUpdateIdea,
	evaluate_idea: handleEvaluateIdea,
	approve_idea: handleApproveIdea,
	discard_idea: handleDiscardIdea,
	convert_idea: handleConvertIdea,
	link_entities: handleLinkEntities,
	unlink_entities: handleUnlinkEntities,
	query_links: handleQueryLinks,
};

export function getHandler(action: string): ActionHandler | undefined {
	return ACTION_ROUTER[action];
}

export type { ActionResult };
