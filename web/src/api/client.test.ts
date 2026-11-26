import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, createFinSimApi } from "./client";

describe("createFinSimApi error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ApiClientError with plain-text fallback when server returns non-JSON 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Invalid CORS request", {
          status: 403,
          statusText: "Forbidden",
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const api = createFinSimApi("live", "https://finsim.example.com");

    await expect(
      api.createTransfer("sandbox", "key-1", {
        from: { institutionId: "bank-a", accountReference: "ACC-1" },
        to: { institutionId: "bank-b", accountReference: "ACC-2" },
        money: { amount: "10.00", currency: "USD" },
        reference: "TEST",
      }),
    ).rejects.toMatchObject({
      name: "Error",
      status: 403,
      code: "HTTP_403",
      message: "Invalid CORS request",
    });
  });

  it("preserves structured backend ErrorResponse code and message for JSON errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "RECONCILIATION_REQUIRED",
            message: "Transfer outcome is UNKNOWN",
          }),
          {
            status: 409,
            statusText: "Conflict",
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const api = createFinSimApi("live", "https://finsim.example.com");

    try {
      await api.getTransfer("tx-123");
      expect.unreachable("Expected ApiClientError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(409);
      expect((err as ApiClientError).code).toBe("RECONCILIATION_REQUIRED");
      expect((err as ApiClientError).message).toBe("Transfer outcome is UNKNOWN");
    }
  });
});
