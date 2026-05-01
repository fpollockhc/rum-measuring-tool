import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock filesystem before importing store
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn()
}));

const { createTfeMigration, getTfeMigration, listTfeMigrations, updateTfeMigration, redactTfeRequest } = await import("./tfe-store.js");

describe("tfe-store", () => {
  describe("redactTfeRequest", () => {
    it("redacts the TFE token", () => {
      const result = redactTfeRequest({
        tfeHostname: "https://tfe.example.com",
        tfeToken: "super-secret-token",
        organization: "my-org"
      });
      expect(result.tfeToken).toBe("***redacted***");
      expect(result.tfeHostname).toBe("https://tfe.example.com");
      expect(result.organization).toBe("my-org");
    });

    it("handles empty token", () => {
      const result = redactTfeRequest({
        tfeHostname: "https://tfe.example.com",
        tfeToken: "",
        organization: "my-org"
      });
      expect(result.tfeToken).toBe("");
    });
  });

  describe("createTfeMigration", () => {
    it("creates a migration record with queued status", () => {
      const record = createTfeMigration({
        tfeHostname: "https://tfe.example.com",
        tfeToken: "secret-token",
        organization: "test-org"
      });

      expect(record.id).toBeTruthy();
      expect(record.status).toBe("queued");
      expect(record.createdAt).toBeTruthy();
      expect(record.updatedAt).toBeTruthy();
      expect(record.request.tfeToken).toBe("***redacted***");
      expect(record.request.organization).toBe("test-org");
    });
  });

  describe("getTfeMigration", () => {
    it("returns null for unknown ID", () => {
      expect(getTfeMigration("nonexistent")).toBeNull();
    });

    it("returns created record", () => {
      const created = createTfeMigration({
        tfeHostname: "https://tfe.example.com",
        tfeToken: "token",
        organization: "org"
      });
      const fetched = getTfeMigration(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });
  });

  describe("updateTfeMigration", () => {
    it("updates record status", () => {
      const created = createTfeMigration({
        tfeHostname: "https://tfe.example.com",
        tfeToken: "token",
        organization: "org"
      });

      const updated = updateTfeMigration(created.id, (current) => ({
        ...current,
        status: "running",
        progress: { phase: "connecting" }
      }));

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("running");
      expect(updated!.progress?.phase).toBe("connecting");
    });

    it("returns null for unknown ID", () => {
      expect(updateTfeMigration("nonexistent", (c) => c)).toBeNull();
    });
  });

  describe("listTfeMigrations", () => {
    it("returns all created records in the list", () => {
      const r1 = createTfeMigration({
        tfeHostname: "https://tfe1.example.com",
        tfeToken: "t1",
        organization: "org1"
      });
      const r2 = createTfeMigration({
        tfeHostname: "https://tfe2.example.com",
        tfeToken: "t2",
        organization: "org2"
      });

      const list = listTfeMigrations();
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some((r) => r.id === r1.id)).toBe(true);
      expect(list.some((r) => r.id === r2.id)).toBe(true);
    });
  });
});
