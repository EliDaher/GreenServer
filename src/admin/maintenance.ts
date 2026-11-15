import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { auth, database } from "../firebaseConfig";
import { accountEmail, validUsername } from "../controllers/auth.controller";
import { get, ref, update } from "../database";

async function backup(path: string | undefined) {
  if (!path) throw new Error("Provide a new backup file path outside the repository");
  const data = (await database.ref().get()).exportVal();
  await writeFile(path, JSON.stringify(data), { flag: "wx", mode: 0o600 });
}

async function migrateWarehouses() {
    const warehouseSet = new Set<string>();



    // 1️⃣ من products
    const productsSnap = await get(ref(database, "products"));
    if (productsSnap.exists()) {
      productsSnap.forEach(warehouseNode => {
        if (warehouseNode.key) {
          warehouseSet.add(warehouseNode.key);
        }
      });
    }

    // 2️⃣ من purchases
    const purchasesSnap = await get(ref(database, "purchases"));
    if (purchasesSnap.exists()) {
      purchasesSnap.forEach(p => {
        const w = p.val()?.warehouse;
        if (typeof w === "string" && w.trim()) warehouseSet.add(w);
      });
    }

    // 3️⃣ من returns
    const returnsSnap = await get(ref(database, "returns"));
    if (returnsSnap.exists()) {
      returnsSnap.forEach(r => {
        const w = r.val()?.warehouse;
        if (typeof w === "string" && w.trim()) warehouseSet.add(w);
      });
    }

    // 4️⃣ من sells → products[]
    const sellsSnap = await get(ref(database, "sells"));
    if (sellsSnap.exists()) {
      sellsSnap.forEach(sell => {
        const products = sell.val()?.products || [];
        products.forEach((p: any) => {
          if (typeof p?.warehouse === "string" && p.warehouse.trim()) warehouseSet.add(p.warehouse);
        });
      });
    }


  const existing = (await database.ref("warehouses").get()).val() ?? {};
  const names = new Set(Object.values(existing).map((item: any) => item?.name));
  const additions: Record<string, object> = {};
  const now = new Date().toISOString();

  for (const raw of warehouseSet) {
    const name = raw.trim();
    if (!name || names.has(name)) continue;
    const id = "warehouse_" + createHash("sha256").update(name).digest("hex").slice(0, 20);
    if (Object.prototype.hasOwnProperty.call(existing, id)) throw new Error("Warehouse ID collision");
    names.add(name);
    additions[id] = { id, name, location: "", isActive: true, createdDate: now, updatedDate: now };
  }

  if (Object.keys(additions).length) await update(ref(database, "warehouses"), additions);
  console.log("Warehouses added:", Object.keys(additions).length);
}

async function resetAccounts() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const accounts: unknown = JSON.parse(input);
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
    throw new Error("Expected a JSON object of usernames to temporary passwords on stdin");
  }

  for (const [username, password] of Object.entries(accounts)) {
    if (!validUsername(username) || typeof password !== "string" || password.length < 12) {
      throw new Error("Use valid usernames and fresh passwords of at least 12 characters");
    }
  }

  for (const [username, password] of Object.entries(accounts)) {
    const profile = database.ref("users").child(username);
    const existing = (await profile.get()).val();
    if (!existing || !["admin", "staff"].includes(existing.role)) throw new Error("Missing user profile");
    if (existing.password === password) throw new Error("Choose a fresh password");
    const email = accountEmail(username);
    const account = await auth.getUser(username).catch((error) => {
      if (error.code === "auth/user-not-found") return null;
      throw error;
    });
    if (account) {
      if (account.email !== email) throw new Error("Existing Auth account has a different email");
      await auth.updateUser(username, { password });
      await auth.revokeRefreshTokens(username);
    } else {
      await auth.createUser({ uid: username, email, password });
    }
    await profile.child("password").remove();
  }
  console.log("Accounts reset:", Object.keys(accounts).length);
}

async function main() {
  const [command, backupPath] = process.argv.slice(2);
  if (!["backup", "warehouses", "accounts"].includes(command)) {
    throw new Error("Usage: maintenance <backup|warehouses|accounts> <new-backup-path>");
  }
  await backup(backupPath);
  if (command === "warehouses") await migrateWarehouses();
  if (command === "accounts") await resetAccounts();
}

main().catch((error) => {
  console.error("Maintenance failed:", error.message);
  process.exitCode = 1;
}).finally(() => database.goOffline());
