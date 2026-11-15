const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");

if (
  process.env.FIREBASE_projectId !== "demo-green" ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "") ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "")
) {
  throw new Error("Run only against the local demo-green emulators.");
}

const app = require("../dist/app").default;
const { database, auth } = require("../dist/firebaseConfig");
const { accountEmail } = require("../dist/controllers/auth.controller");

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const admin = "admin_" + suffix;
  const staff = "staff_" + suffix;
  const customerId = "customer_" + suffix;
  const supplierId = "supplier_" + suffix;
  const warehouse = "source_" + suffix;
  const destination = "target_" + suffix;
  const product = {
    id: "p1", code: "P1", name: "Sample", category: "test", quantity: 1,
    warehouse, sellPrice: 10, payPrice: 5, unit: "pc",
  };
  const password = randomUUID();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;

  async function request(path, options = {}) {
    const { body, token, key, actor } = options;
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(actor ? { "x-executer": actor } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    for (const [username, role] of [[admin, "admin"], [staff, "staff"]]) {
      await auth.createUser({ uid: username, email: accountEmail(username), password });
      await database.ref("users/" + username).set({ username, role });
    }
    await database.ref().update({
      ["products/" + warehouse + "/p1"]: product,
      ["customer/" + customerId]: { id: customerId, name: "Test customer", balance: 0 },
      ["supplier/" + supplierId]: { id: supplierId, name: "Test supplier", balance: 0 },
    });
    assert.equal((await request("/ready")).status, 200);
    const publicRead = await fetch("http://" + process.env.FIREBASE_DATABASE_EMULATOR_HOST + "/products.json?ns=demo-green-default-rtdb");
    assert.equal(publicRead.status, 401);
    assert.equal((await request("/api/products", { actor: admin })).status, 401);
    const login = await request("/api/auth/login", { body: { username: admin, password } });
    const staffLogin = await request("/api/auth/login", { body: { username: staff, password } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(staffLogin.status, 200, JSON.stringify(staffLogin.body));
    const token = login.body.token;
    assert.equal((await request("/api/users", { token: staffLogin.body.token, actor: admin })).status, 403);
    assert.equal((await request("/api/reports/today-overview", { token: staffLogin.body.token })).status, 403);

    const sale = {
      customerId, totalPrice: 10, remainingDebt: 10, paymentStatus: "debt",
      exchangeRate: 1, amount_base: 10, currency: "USD", products: [{ ...product, qty: 1 }],
    };
    const sell = (key, newSell = sale) =>
      request("/api/transactions/sell", { token, key, body: { newSell }, actor: staff });
    const failed = await sell(randomUUID(), { ...sale, products: [sale.products[0], { ...sale.products[0], id: "missing" }] });
    assert.equal(failed.status, 400, JSON.stringify(failed.body));
    assert.equal((await database.ref("products/" + warehouse + "/p1/quantity").get()).val(), 1);
    assert.equal((await database.ref("customer/" + customerId + "/balance").get()).val(), 0);
    assert.equal(Object.values((await database.ref("sells").get()).val() ?? {}).filter((entry) => entry.customerId === customerId).length, 0);

    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(keys.map((key) => sell(key)));
    assert.equal(results.filter(({ status }) => status === 200).length, 1, JSON.stringify(results));
    const failedIndex = results.findIndex(({ status }) => status !== 200);
    const rejected = results[failedIndex];
    assert.ok([400, 409].includes(rejected.status), JSON.stringify(rejected));
    if (rejected.status === 409) assert.equal((await sell(keys[failedIndex])).status, 400);
    const index = results.findIndex((result) => result.status === 200);
    const successful = results[index];
    assert.equal(successful.body.data.executer, admin);
    assert.deepEqual(await sell(keys[index]), successful);
    assert.equal((await sell(keys[index], { ...sale, totalPrice: 11 })).status, 409);
    assert.equal((await database.ref("products/" + warehouse + "/p1/quantity").get()).val(), 0);
    assert.equal((await database.ref("customer/" + customerId + "/balance").get()).val(), -10);

    const transact = async (path, body) => {
      const result = await request("/api/transactions/" + path, { token, body, key: randomUUID() });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.data;
    };
    await transact("customerPayment", { paymentData: {
      customerId, type: "income", amount: 4, currency: "USD", exchangeRate: 1, amount_base: 4,
    } });
    assert.equal((await database.ref("customer/" + customerId + "/balance").get()).val(), -6);

    const purchase = await transact("purchase", {
      newProduct: { ...product, quantity: 3 },
      newPurchase: {
        supplierId, code: product.code, warehouse, quantity: 3, payPrice: 5,
        currency: "USD", exchangeRate: 1, amount_base: 15, totalPrice: 15, remainingDebt: 15,
      },
    });
    await transact("SupplierReturn", { newReturn: {
      productCode: product.code, productId: product.id, supplierId, warehouse, qty: 1,
      returnValue: 5, referenceId: purchase.id, partValue: 0, returnType: "debt", reason: "test",
    } });
    assert.equal((await database.ref("supplier/" + supplierId + "/balance").get()).val(), 10);

    await transact("warehouseTransfer", { transferData: {
      productId: product.id, oldWarehouse: warehouse, newWarehouse: destination,
      quantity: 1, amount: 0, amount_base: 0, exchangeRate: 1, currency: "USD", note: "",
    } });
    assert.equal((await database.ref("products/" + warehouse + "/p1/quantity").get()).val(), 1);
    const transferred = (await database.ref("products/" + destination).get()).val();
    assert.equal(Object.values(transferred)[0].quantity, 1);
    assert.equal((await request("/api/reports/today-overview", { token })).status, 200);
    await transact("supplierPayment", { paymentData: {
      supplierId, type: "expense", amount: -4, currency: "USD", exchangeRate: 1, amount_base: -4,
    } });
    assert.equal((await database.ref("supplier/" + supplierId + "/balance").get()).val(), 6);

    await transact("CustomerReturn", { newReturn: {
      customerId, referenceId: successful.body.data.id, returnType: "debt", partValue: 0, reason: "test",
      items: [{ productId: product.id, productCode: product.code, warehouse, qty: 1, returnValue: 10 }],
    } });
    assert.equal((await database.ref("products/" + warehouse + "/p1/quantity").get()).val(), 2);

    const folder = await mkdtemp(join(tmpdir(), "green-backup-"));
    try {
      const path = join(folder, "backup.json");
      await promisify(execFile)(process.execPath, ["dist/admin/maintenance.js", "backup", path], { timeout: 15000 });
      const exported = JSON.parse(await readFile(path, "utf8"));
      const restore = database.ref("test_restore_" + suffix);
      await restore.set(exported);
      assert.deepEqual((await restore.child("customer/" + customerId).get()).val(),
        (await database.ref("customer/" + customerId).get()).val());
      assert.equal((await restore.child("products/" + warehouse + "/p1/quantity").get()).val(), 2);
      await restore.remove();

      const legacy = "legacy_" + suffix;
      const oldPassword = randomUUID();
      const newPassword = randomUUID();
      await database.ref("users/" + legacy).set({ username: legacy, role: "staff", password: oldPassword });
      const migration = spawn(process.execPath, ["dist/admin/maintenance.js", "accounts", join(folder, "before-accounts.json")], {
        stdio: ["pipe", "ignore", "inherit"],
      });
      const completed = new Promise((resolve, reject) => {
        migration.once("error", reject);
        migration.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Account migration failed")));
      });
      migration.stdin.end(JSON.stringify({ [legacy]: newPassword }));
      await completed;
      assert.equal((await database.ref("users/" + legacy + "/password").get()).exists(), false);
      assert.equal((await request("/api/auth/login", { body: { username: legacy, password: oldPassword } })).status, 401);
      assert.equal((await request("/api/auth/login", { body: { username: legacy, password: newPassword } })).status, 200);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    console.log("Emulator acceptance checks passed.");
  } finally {
    server.close();
    database.goOffline();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

