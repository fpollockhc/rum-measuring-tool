import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fs operations to avoid touching the real filesystem during tests
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  renameSync: vi.fn()
}));

// Must import after mocking
const { createScan, getScan, listScans, updateScan } = await import("./store.js");

describe("scan store", () => {
  it("creates a scan with queued status and UUID", () => {
    const scan = createScan({
      providers: ["aws"],
      targets: [{ provider: "aws", bucketName: "my-bucket" }]
    });
    expect(scan.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(scan.status).toBe("queued");
    expect(scan.createdAt).toBeDefined();
    expect(scan.updatedAt).toBeDefined();
    expect(scan.request.providers).toEqual(["aws"]);
  });

  it("retrieves a created scan by ID", () => {
    const scan = createScan({
      providers: ["local"],
      targets: [{ provider: "local", directoryPath: "/tmp/states" }]
    });
    const retrieved = getScan(scan.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(scan.id);
  });

  it("returns null for non-existent scan ID", () => {
    expect(getScan("non-existent-id")).toBeNull();
  });

  it("updates a scan record and sets updatedAt", async () => {
    const scan = createScan({
      providers: ["aws"],
      targets: [{ provider: "aws", bucketName: "test" }]
    });
    // Small delay to ensure updatedAt differs
    await new Promise((r) => setTimeout(r, 10));
    const updated = updateScan(scan.id, (current) => ({
      ...current,
      status: "completed",
      summary: {
        bucketsScanned: 1,
        stateFilesParsed: 5,
        totalRum: 42,
        excludedResources: 3
      }
    }));
    expect(updated?.status).toBe("completed");
    expect(updated?.summary?.totalRum).toBe(42);
    expect(updated?.updatedAt).not.toBe(scan.updatedAt);
  });

  it("returns null when updating non-existent scan", () => {
    const result = updateScan("missing-id", (c) => c);
    expect(result).toBeNull();
  });

  it("lists scans in reverse chronological order", async () => {
    const scan1 = createScan({
      providers: ["aws"],
      targets: [{ provider: "aws", bucketName: "b1" }]
    });
    // Ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const scan2 = createScan({
      providers: ["aws"],
      targets: [{ provider: "aws", bucketName: "b2" }]
    });
    const all = listScans();
    const ids = all.map((s) => s.id);
    expect(ids.indexOf(scan2.id)).toBeLessThan(ids.indexOf(scan1.id));
  });
});
