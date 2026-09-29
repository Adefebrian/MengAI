// projects table access. Only this module reads or writes `projects`.
import type { Db } from "../../core/ports/db";
import { num } from "../../lib/sql";

const OWNER = "owner";

export interface ProjectRow {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
}

type RawRow = { id: string; name: string; workspace_path: string; created_at: unknown; updated_at: unknown };

const decode = (r: RawRow): ProjectRow => ({
  id: r.id,
  name: r.name,
  workspacePath: r.workspace_path,
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

export function createProjectsRepo(db: Db) {
  return {
    async list(): Promise<ProjectRow[]> {
      const rows = await db.query<RawRow>`
        select id, name, workspace_path, created_at, updated_at from projects
        where owner_id = ${OWNER} order by updated_at desc, id desc`;
      return rows.map(decode);
    },
    async get(id: string): Promise<ProjectRow | null> {
      const rows = await db.query<RawRow>`
        select id, name, workspace_path, created_at, updated_at from projects
        where id = ${id} and owner_id = ${OWNER}`;
      return rows[0] ? decode(rows[0]) : null;
    },
    async insert(row: ProjectRow): Promise<void> {
      await db.query`
        insert into projects (id, owner_id, name, workspace_path, created_at, updated_at)
        values (${row.id}, ${OWNER}, ${row.name}, ${row.workspacePath}, ${row.createdAt}, ${row.updatedAt})`;
    },
    async remove(id: string): Promise<boolean> {
      const rows = await db.query<{ id: string }>`delete from projects where id = ${id} and owner_id = ${OWNER} returning id`;
      return rows.length > 0;
    },
    async touch(id: string, now: number): Promise<boolean> {
      const rows = await db.query<{ id: string }>`update projects set updated_at = ${now} where id = ${id} and owner_id = ${OWNER} returning id`;
      return rows.length > 0;
    },
  };
}

export type ProjectsRepo = ReturnType<typeof createProjectsRepo>;
