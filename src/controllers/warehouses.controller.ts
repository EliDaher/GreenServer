import { v4 as uuidv4 } from "uuid";
import { Request, Response } from "express";
import { ref, get, set, update, remove } from "../database";
import { database } from "../firebaseConfig";
import { Warehouse } from "../types/warehouse";

/* =========================================================
   ✅ 1. جلب جميع المستودعات
   ========================================================= */
export const getAll = async (_req: Request, res: Response) => {
  try {
    const dbRef = ref(database, "warehouses");
    const snapshot = await get(dbRef);

    res.json(snapshot.exists() ? Object.values(snapshot.val()) : []);
  } catch (error: any) {
    console.error("Error fetching warehouses:", error);
    res.status(500).json({ error: error.message });
  }
};

/* =========================================================
   ✅ 2. إنشاء مستودع جديد
   ========================================================= */
export const create = async (req: Request, res: Response) => {
  try {
    const now = new Date().toLocaleString();
    const id = uuidv4();

    const newWarehouse: Warehouse = {
      id,
      name: req.body.name,
      location: req.body.location || "",
      isActive: true,
      createdDate: now,
      updatedDate: now,
    };

    await set(ref(database, `warehouses/${id}`), newWarehouse);

    res.json({
      message: "✅ تم إنشاء المستودع بنجاح",
      data: newWarehouse,
    });
  } catch (error: any) {
    console.error("Error creating warehouse:", error);
    res.status(500).json({ error: error.message });
  }
};

/* =========================================================
   ✅ 3. إنشاء مستودع داخليًا
   ========================================================= */
export const createWarehouseInternal = async (
  data: Omit<Warehouse, "id" | "createdDate" | "updatedDate">,
): Promise<Warehouse> => {
  const id = uuidv4();
  const now = new Date().toLocaleString();

  const warehouse: Warehouse = {
    ...data,
    id,
    createdDate: now,
    updatedDate: now,
  };

  await set(ref(database, `warehouses/${id}`), warehouse);
  return warehouse;
};

/* =========================================================
   ✅ 4. تحديث مستودع داخليًا
   ========================================================= */
export const updateWarehouseInternal = async (
  id: string,
  updates: Partial<Warehouse>,
): Promise<Warehouse | null> => {
  const dbRef = ref(database, `warehouses/${id}`);
  const snapshot = await get(dbRef);
  if (!snapshot.exists()) return null;

  const warehouse = snapshot.val() as Warehouse;

  const updatedWarehouse: Warehouse = {
    ...warehouse,
    ...updates,
    updatedDate: new Date().toLocaleString(),
  };

  await update(dbRef, updatedWarehouse);
  return updatedWarehouse;
};

/* =========================================================
   ✅ 5. حذف مستودع داخليًا
   ⚠️ يفضل تعطيله بدل الحذف الحقيقي
   ========================================================= */
export const deleteWarehouseInternal = async (id: string): Promise<boolean> => {
  const dbRef = ref(database, `warehouses/${id}`);
  const snapshot = await get(dbRef);
  if (!snapshot.exists()) return false;

  await remove(dbRef);
  return true;
};

/* =========================================================
   ✅ 6. جلب جميع المستودعات داخليًا
   ========================================================= */
export const getAllWarehousesInternal = async (): Promise<Warehouse[]> => {
  const dbRef = ref(database, "warehouses");
  const snapshot = await get(dbRef);
  return snapshot.exists() ? Object.values(snapshot.val()) : [];
};

/* =========================================================
   ✅ 7. جلب مستودع واحد داخليًا
   ========================================================= */
export const getWarehouseByIdInternal = async (
  id: string,
): Promise<Warehouse | null> => {
  const dbRef = ref(database, `warehouses/${id}`);
  const snapshot = await get(dbRef);
  return snapshot.exists() ? snapshot.val() : null;
};

/* =========================================================
   ✅ 8. تعطيل مستودع بدل الحذف (Best Practice)
   ========================================================= */
export const deactivateWarehouseInternal = async (
  id: string,
): Promise<Warehouse | null> => {
  return updateWarehouseInternal(id, { isActive: false });
};

