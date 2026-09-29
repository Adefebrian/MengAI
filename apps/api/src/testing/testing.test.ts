import { describe, expect, test } from "bun:test";
import { num } from "../lib/sql";
import { captureEvents, createTestDb, fakeClock, memoryKv } from "./index";

describe("test kit", () => {
  test("in-memory db has the schema and tx rolls back", async () => {
    const db = await createTestDb();
    const tables = await db.query<{ name: string }>`select name from sqlite_master where type = 'table'`;
    const names = tables.map((t) => t.name);
    for (const t of ["runs", "agents", "tasks", "events", "audit_log", "lessons", "providers"]) expect(names).toContain(t);
    await expect(
      db.tx(async (tx) => {
        await tx.query`insert into projects (id, name, workspace_path, created_at, updated_at) values (${"p1"}, ${"x"}, ${"/tmp/x"}, ${1}, ${1})`;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await db.query`select count(*) as c from projects`;
    expect(num((rows[0] as any).c)).toBe(0);
    await db.close();
  });
  test("fakes behave", async () => {
    const kv = memoryKv();
    expect(await kv.incr("a", 60)).toBe(1);
    expect(await kv.incr("a", 60)).toBe(2);
    expect(await kv.setNx("l", "1", 60)).toBe(true);
    expect(await kv.setNx("l", "1", 60)).toBe(false);
    const sink = captureEvents(fakeClock());
    await sink.publish({ type: "error", runId: null, data: { message: "x", code: null } });
    expect(sink.ofType("error")).toHaveLength(1);
    expect(sink.events[0]!.seq).toBe(1);
  });
});
