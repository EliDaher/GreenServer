const assert = require("node:assert/strict");
const { test } = require("node:test");
const { atomic, get, ref, set } = require("../dist/database");

function databaseWithStock(quantity) {
  let tree = { products: { source: { item: { quantity } } } };
  let successfulCommits = 0;
  const database = {
    ref(path) {
      if (path) return { toString: () => "https://demo.invalid/" + path };
      return {
        on: (_type, listener) => listener,
        off: () => {},
        once: async () => ({ val: () => structuredClone(tree) }),
        transaction: async (callback) => {
          const next = callback(structuredClone(tree));
          if (next === undefined) return { committed: false };
          tree = structuredClone(next);
          successfulCommits++;
          return { committed: true };
        },
      };
    },
    state: () => tree,
    commits: () => successfulCommits,
  };
  return database;
}

async function sell(database, id) {
  return atomic(database, async () => {
    const stock = ref(database, "products/source/item/quantity");
    const quantity = (await get(stock)).val();
    if (quantity < 1) throw new Error("Out of stock");
    await set(ref(database, "sells/" + id), { quantity: 1 });
    await set(stock, quantity - 1);
  });
}

test("aborts all staged changes if the operation fails", async () => {
  const database = databaseWithStock(1);
  await assert.rejects(atomic(database, async () => {
    await set(ref(database, "sells/partial"), { quantity: 1 });
    await set(ref(database, "products/source/item/quantity"), 0);
    throw new Error("Customer not found");
  }), /Customer not found/);
  assert.deepEqual(database.state(), { products: { source: { item: { quantity: 1 } } } });
  assert.equal(database.commits(), 0);
});

test("rechecks stock after a concurrent commit", async () => {
  const database = databaseWithStock(1);
  const outcomes = await Promise.allSettled([sell(database, "first"), sell(database, "second")]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(outcomes.find(({ status }) => status === "rejected").reason.message, /Out of stock/);
  assert.equal(database.state().products.source.item.quantity, 0);
  assert.equal(Object.keys(database.state().sells).length, 1);
  assert.equal(database.commits(), 1);
});

