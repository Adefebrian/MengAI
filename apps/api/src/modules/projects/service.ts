// ProjectsService: project records bound to a jailed workspace root.
// Default workspaces live under config.workspacesDir as <slug>-<id8>. In
// local mode the owner may bind an existing folder instead; it must be a
// real directory that is not /, the home root or one of its ancestors, not
// inside a credential or system folder, and not overlapping the app data dir.
import type { CreateProjectBody, FileContent, FileNodeDTO, ProjectDTO } from "@mengai/shared";
import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { ModuleContext } from "../../core/module";
import type { ProjectsService, WorkspaceService } from "../../core/services";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/http";
import { createProjectsRepo, type ProjectRow } from "./repo";

export interface ProjectsDeps {
  workspace: WorkspaceService;
}

/** ProjectsService plus the file views the routes expose */
export interface ProjectsServiceImpl extends ProjectsService {
  listFiles(id: string, path: string, depth: number): Promise<FileNodeDTO[]>;
  readFile(id: string, path: string, range: { from?: number; to?: number }): Promise<FileContent>;
}

const HOME_DENY = [".ssh", ".aws", ".gnupg", ".config", ".kube", ".docker", ".azure", ".password-store", "Library"];
const SYSTEM_DENY = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private/etc", "/private/var/db", "/Library", "/Applications", "/cores", "/dev"];

const lastRunKey = (id: string) => `projects:lastRun:${id}`;

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "project";
}

/** last 8 hex chars of the id (the random tail of a UUIDv7, not its clock prefix) */
export const id8 = (id: string) => id.replace(/-/g, "").slice(-8);

const invalidWorkspace = (message: string) => new HttpError(422, "invalid_workspace", message);

const realOr = (p: string) => realpath(p).catch(() => resolve(p));

export function createProjectsService(ctx: ModuleContext, deps: ProjectsDeps): ProjectsServiceImpl {
  const repo = createProjectsRepo(ctx.db);

  async function toDto(row: ProjectRow): Promise<ProjectDTO> {
    return {
      id: row.id,
      name: row.name,
      workspacePath: row.workspacePath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastRunId: (await ctx.kv.get(lastRunKey(row.id)).catch(() => null)) ?? null,
    };
  }

  async function mustGet(id: string): Promise<ProjectRow> {
    const row = await repo.get(id);
    if (!row) throw notFound("project");
    return row;
  }

  async function validateChosenFolder(path: string): Promise<string> {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw invalidWorkspace("workspacePath must be an absolute path");
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      throw invalidWorkspace("workspacePath does not exist");
    }
    if (!(await stat(real)).isDirectory()) throw invalidWorkspace("workspacePath is not a folder");
    const home = await realOr(homedir());
    const dataDir = await realOr(ctx.config.dataDir);
    if (real === "/") throw invalidWorkspace("the filesystem root cannot be a workspace");
    if (inside(home, real)) throw invalidWorkspace("the home folder (or a folder above it) cannot be a workspace; pick a project folder inside it");
    if (inside(real, dataDir) || inside(dataDir, real)) throw invalidWorkspace("the app data folder cannot be part of a workspace");
    for (const d of HOME_DENY) if (inside(real, join(home, d))) throw invalidWorkspace(`folders inside ~/${d} cannot be a workspace`);
    for (const d of SYSTEM_DENY) if (inside(real, d)) throw invalidWorkspace(`system folders cannot be a workspace`);
    return real;
  }

  async function defaultWorkspace(name: string, id: string): Promise<string> {
    const parent = resolve(ctx.config.workspacesDir);
    const dir = join(parent, `${slugify(name)}-${id8(id)}`);
    await mkdir(dir, { recursive: true });
    return realpath(dir);
  }

  const service: ProjectsServiceImpl = {
    async list() {
      return Promise.all((await repo.list()).map(toDto));
    },

    async get(id) {
      return toDto(await mustGet(id));
    },

    async create(input: CreateProjectBody) {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 120) throw badRequest("name must be 1 to 120 characters");
      const id = ctx.clock.id();
      const now = ctx.clock.now();
      let workspacePath: string;
      if (input.workspacePath !== undefined) {
        if (ctx.config.mode !== "local") throw forbidden("choosing a folder is only available in the desktop app");
        workspacePath = await validateChosenFolder(input.workspacePath);
      } else {
        workspacePath = await defaultWorkspace(name, id);
      }
      const row: ProjectRow = { id, name, workspacePath, createdAt: now, updatedAt: now };
      await repo.insert(row);
      ctx.logger.log("info", "project created", { projectId: id, chosen: input.workspacePath !== undefined });
      return toDto(row);
    },

    async remove(id) {
      // record only: the files on disk always stay with the owner
      if (!(await repo.remove(id))) throw notFound("project");
      await ctx.kv.del(lastRunKey(id)).catch(() => undefined);
    },

    async root(id) {
      const row = await mustGet(id);
      try {
        const real = await realpath(row.workspacePath);
        if (!(await stat(real)).isDirectory()) throw notFound("workspace folder");
        return real;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        // a default workspace that was cleaned up is recreated; a chosen folder is never invented
        const parent = await realOr(ctx.config.workspacesDir);
        if (inside(resolve(row.workspacePath), parent) || inside(resolve(row.workspacePath), resolve(ctx.config.workspacesDir))) {
          await mkdir(row.workspacePath, { recursive: true });
          return realpath(row.workspacePath);
        }
        throw notFound("workspace folder");
      }
    },

    async touchRun(id, runId) {
      if (!(await repo.touch(id, ctx.clock.now()))) throw notFound("project");
      // TODO(lead): move to projects.last_run_id once migration 0002 adds the column
      await ctx.kv.set(lastRunKey(id), runId);
    },

    async listFiles(id, path, depth) {
      return deps.workspace.list(await service.root(id), path, depth);
    },

    async readFile(id, path, range) {
      const r = await deps.workspace.read(await service.root(id), path, range);
      return { path, content: r.content, truncated: r.truncated, size: r.size, binary: r.binary };
    },
  };
  return service;
}
