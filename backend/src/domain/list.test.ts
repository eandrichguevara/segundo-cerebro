import { describe, expect, it } from "vitest";
import {
	ListError,
	type ListItem,
	ListStatus,
	canTransition,
	transitionStatus,
	validateCompleteList,
	validateCreateList,
	validateItemIndex,
} from "./list.js";

describe("canTransition", () => {
	it("permite ACTIVE -> COMPLETED", () => {
		expect(canTransition(ListStatus.ACTIVE, ListStatus.COMPLETED)).toBe(true);
	});

	it("permite ACTIVE -> CANCELLED", () => {
		expect(canTransition(ListStatus.ACTIVE, ListStatus.CANCELLED)).toBe(true);
	});

	it("rechaza COMPLETED -> cualquier estado", () => {
		expect(canTransition(ListStatus.COMPLETED, ListStatus.ACTIVE)).toBe(false);
		expect(canTransition(ListStatus.COMPLETED, ListStatus.CANCELLED)).toBe(
			false,
		);
	});

	it("rechaza CANCELLED -> cualquier estado", () => {
		expect(canTransition(ListStatus.CANCELLED, ListStatus.ACTIVE)).toBe(false);
		expect(canTransition(ListStatus.CANCELLED, ListStatus.COMPLETED)).toBe(
			false,
		);
	});
});

describe("transitionStatus", () => {
	it("retorna ok con el nuevo estado si es válido", () => {
		const result = transitionStatus(ListStatus.ACTIVE, ListStatus.COMPLETED);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(ListStatus.COMPLETED);
		}
	});

	it("retorna error INVALID_STATE_TRANSITION si no es válido", () => {
		const result = transitionStatus(ListStatus.COMPLETED, ListStatus.ACTIVE);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.INVALID_STATE_TRANSITION);
		}
	});
});

describe("validateCreateList", () => {
	it("retorna ok si el título es válido", () => {
		const result = validateCreateList({ title: "Lista del super" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.title).toBe("Lista del super");
		}
	});

	it("retorna error si el título está vacío", () => {
		const result = validateCreateList({ title: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.MISSING_REQUIRED_FIELD);
		}
	});

	it("retorna error si el título es undefined", () => {
		const result = validateCreateList({});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.MISSING_REQUIRED_FIELD);
		}
	});

	it("retorna error si el título es solo espacios", () => {
		const result = validateCreateList({ title: "   " });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.MISSING_REQUIRED_FIELD);
		}
	});
});

describe("validateItemIndex", () => {
	const items: ListItem[] = [
		{ content: "tomates", quantity: "2 kg", checked: false },
		{ content: "lechuga", checked: true },
	];

	it("retorna ok si el índice es válido", () => {
		const result = validateItemIndex(items, 0);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.content).toBe("tomates");
		}
	});

	it("retorna error si el índice es negativo", () => {
		const result = validateItemIndex(items, -1);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.INVALID_ITEM_INDEX);
		}
	});

	it("retorna error si el índice excede el array", () => {
		const result = validateItemIndex(items, 2);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.INVALID_ITEM_INDEX);
		}
	});
});

describe("validateCompleteList", () => {
	it("retorna ok si todos los items están checked", () => {
		const items: ListItem[] = [
			{ content: "tomates", checked: true },
			{ content: "lechuga", checked: true },
		];
		const result = validateCompleteList(items);
		expect(result.ok).toBe(true);
	});

	it("retorna ok si la lista está vacía", () => {
		const result = validateCompleteList([]);
		expect(result.ok).toBe(true);
	});

	it("retorna error si hay items unchecked", () => {
		const items: ListItem[] = [
			{ content: "tomates", checked: true },
			{ content: "lechuga", checked: false },
		];
		const result = validateCompleteList(items);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ListError.LIST_HAS_UNCHECKED_ITEMS);
		}
	});
});
