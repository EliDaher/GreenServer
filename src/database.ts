import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { Database, Reference } from "firebase-admin/database";
export { getDatabase } from "firebase-admin/database";

type Tree = Record<string, any>;
const staged = new AsyncLocalStorage<Tree>();

export const ref = (database: Database, path?: string) => database.ref(path);

const pathOf = (reference: Reference) =>
  new URL(reference.toString()).pathname.split("/").filter(Boolean).map(decodeURIComponent);

function write(tree: Tree, path: string[], value: unknown) {
  const key = path.pop();
  if (!key) throw new Error("Root writes must use an explicit child path");
  let node = tree;
  for (const segment of path) {
    if (!Object.prototype.hasOwnProperty.call(node, segment) || node[segment] == null || typeof node[segment] !== "object") {
      Object.defineProperty(node, segment, { value: {}, enumerable: true, writable: true, configurable: true });
    }
    node = node[segment];
  }
  if (value === undefined) throw new Error("Undefined database value");
  if (value === null) delete node[key];
  else Object.defineProperty(node, key, { value: structuredClone(value), enumerable: true, writable: true, configurable: true });
}

export async function get(reference: Reference): Promise<{
  val(): any;
  exists(): boolean;
  forEach(callback: (snapshot: { key: string; val(): any }) => void): unknown;
}> {
  const tree = staged.getStore();
  if (!tree) return reference.get();
  const value = pathOf(reference).reduce<any>(
    (node, key) => node && Object.prototype.hasOwnProperty.call(node, key) ? node[key] : null,
    tree,
  );
  return {
    val: () => structuredClone(value),
    exists: () => value != null,
    forEach: (callback) => Object.entries(value ?? {}).forEach(([key, child]) =>
      callback({ key, val: () => structuredClone(child) })),
  };
}

export async function set(reference: Reference, value: unknown) {
  const tree = staged.getStore();
  if (tree) write(tree, pathOf(reference), value);
  else await reference.set(value);
}

export async function update(reference: Reference, value: object) {
  const tree = staged.getStore();
  if (!tree) return reference.update(value);
  for (const [key, child] of Object.entries(value)) {
    write(tree, [...pathOf(reference), ...key.split("/")], child);
  }
}

export const remove = (reference: Reference) => set(reference, null);

export function push(reference: Reference): Reference;
export function push(reference: Reference, value: unknown): Promise<Reference>;
export function push(reference: Reference, value?: unknown) {
  const child: Reference = reference.push();
  return value === undefined ? child : set(child, value).then(() => child);
}

export class WriteConflict extends Error {}

export class PersistenceError extends Error {
  constructor(readonly cause: unknown) {
    super("Database unavailable");
  }
}

async function persist<T>(operation: Promise<T>) {
  try {
    return await operation;
  } catch (error) {
    throw new PersistenceError(error);
  }
}

export async function atomic<T>(database: Database, operation: () => Promise<T>): Promise<T> {
  const root = database.ref();
  const listener = root.on("value", () => {});
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = (await persist(root.once("value"))).val();
      const draft = structuredClone(before ?? {});
      const result = await staged.run(draft, operation);
      if (isDeepStrictEqual(before ?? {}, draft)) return result;
      const commit = await persist(root.transaction(
        (current) => isDeepStrictEqual(before, current) ? draft : undefined,
        undefined,
        false,
      ));
      if (commit.committed) return result;
      if (attempt < 3) await delay(15 * (2 ** attempt));
    }
    throw new WriteConflict("Database changed concurrently. Retry using the same request ID.");
  } finally {
    root.off("value", listener);
  }
}
