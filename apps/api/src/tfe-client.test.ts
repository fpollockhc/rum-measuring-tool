import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We test the pure logic and URL construction without hitting real TFE.
// The actual HTTP calls are tested via integration tests.

describe("tfe-client module structure", () => {
  it("exports expected functions", async () => {
    const client = await import("./tfe-client.js");
    expect(typeof client.validateConnection).toBe("function");
    expect(typeof client.getOrganization).toBe("function");
    expect(typeof client.listAllWorkspaces).toBe("function");
    expect(typeof client.getCurrentStateVersion).toBe("function");
    expect(typeof client.downloadState).toBe("function");
  });
});

describe("TFE client URL construction", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("getOrganization calls correct endpoint", async () => {
    const { getOrganization } = await import("./tfe-client.js");

    let capturedUrl = "";
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(
        JSON.stringify({
          data: {
            id: "org-123",
            attributes: { name: "my-org", email: "admin@example.com" }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await getOrganization(
      { hostname: "https://tfe.example.com", token: "test-token" },
      "my-org"
    );

    expect(capturedUrl).toBe("https://tfe.example.com/api/v2/organizations/my-org");
    expect(result.name).toBe("my-org");
    expect(result.email).toBe("admin@example.com");
  });

  it("handles 404 for getCurrentStateVersion gracefully", async () => {
    const { getCurrentStateVersion } = await import("./tfe-client.js");

    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ errors: [{ status: "404" }] }), {
        status: 404,
        statusText: "Not Found"
      });
    }) as typeof fetch;

    const result = await getCurrentStateVersion(
      { hostname: "https://tfe.example.com", token: "test-token" },
      "ws-no-state"
    );

    expect(result).toBeNull();
  });

  it("handles rate limiting with retry", async () => {
    const { getOrganization } = await import("./tfe-client.js");
    let callCount = 0;

    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("", {
          status: 429,
          headers: { "retry-after": "0" }
        });
      }
      return new Response(
        JSON.stringify({
          data: { id: "org-1", attributes: { name: "retry-org" } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await getOrganization(
      { hostname: "https://tfe.example.com", token: "tok" },
      "retry-org"
    );

    expect(callCount).toBe(2);
    expect(result.name).toBe("retry-org");
  });
});

