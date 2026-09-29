// Business logic for the example module. Orchestrates its own repo and the
// CachePort injected from core, never a sibling module's service/repo and
// never a raw infra client. Framework-agnostic: nothing here touches Hono.
import type { CachePort } from "./ports";
import { createInMemoryExampleRepo, type ExampleRepo, type Item } from "./repo";

export interface ExampleService {
  list(): Item[];
  create(name: string): Item;
  /** View count for an item, tracked through the injected cache port. */
  recordView(id: string): Promise<number>;
}

export interface ExampleServiceDeps {
  cache: CachePort;
  repo?: ExampleRepo;
}

export function createExampleService({ cache, repo = createInMemoryExampleRepo() }: ExampleServiceDeps): ExampleService {
  return {
    list(): Item[] {
      return repo.list();
    },
    create(name: string): Item {
      return repo.create(name);
    },
    async recordView(id: string): Promise<number> {
      return cache.incr(`example:views:${id}`);
    },
  };
}
