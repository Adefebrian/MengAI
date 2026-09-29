// Data access for this module's own "items" only. In-memory on purpose:
// this module is the template's trivial reference implementation, not a
// real domain, so there is no table to back it with yet. A real module
// would swap this for a repo that queries its own tables through the
// DbPort from core/ports/db.ts, still returning the same shape below.
export interface Item {
  id: string;
  name: string;
  createdAt: string;
}

export interface ExampleRepo {
  list(): Item[];
  create(name: string): Item;
}

/** Fresh, isolated store per call, so each module instance (and each test) starts empty. */
export function createInMemoryExampleRepo(): ExampleRepo {
  const items: Item[] = [];
  return {
    list(): Item[] {
      return items.slice();
    },
    create(name: string): Item {
      const item: Item = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
      };
      items.push(item);
      return item;
    },
  };
}
