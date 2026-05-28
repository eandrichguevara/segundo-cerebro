import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: { AUTH_TOKEN: "test-token-123" },
}));

import { verifyAuth } from "./index.js";

describe("verifyAuth", () => {
	it("retorna true si el token coincide", () => {
		expect(verifyAuth("test-token-123")).toBe(true);
	});

	it("retorna false si el token no coincide", () => {
		expect(verifyAuth("wrong-token")).toBe(false);
	});

	it("retorna false si el token es string vacío", () => {
		expect(verifyAuth("")).toBe(false);
	});

	it("retorna false si el token es undefined", () => {
		expect(verifyAuth(undefined)).toBe(false);
	});

	it("retorna false si el token es null", () => {
		expect(verifyAuth(null)).toBe(false);
	});

	it("retorna false si el token es un número", () => {
		expect(verifyAuth(123)).toBe(false);
	});
});
