import { createHash } from "node:crypto";
import { requirePermission } from "../controllers/auth.controller";
import express, { Request, Response } from "express";
import { atomic, get, push, ref, set, PersistenceError, WriteConflict } from "../database";
import {
  customerPayment,
  handleCustomerReturn,
  handlePurchase,
  handleSell,
  handleSupplierReturn,
  supplierPayment,
  warehouseTransfer,
} from "../functions/transactions";
import { addAfterSellDiscountInternal } from "../controllers/sells.controller";
import { updateCustomerBalanceInternal } from "../controllers/customer.controller";
import { database } from "../firebaseConfig";

const router = express.Router();

const getExecuter = (res: Response): string => res.locals.executer;

class RequestConflict extends Error {}

const validKey = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 && !/[.#$\[\]/\u0000-\u001f\u007f]/.test(value);

const nonNegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validDebt = (value: any) => nonNegative(value.totalPrice) &&
  nonNegative(value.remainingDebt) && value.remainingDebt <= value.totalPrice;
const validReturnType = (value: unknown) => value === "cash" || value === "debt" || value === "part";

const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;

async function execute<T>(req: Request, res: Response, operation: () => Promise<T>) {
  const key = req.header("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new Error("Invalid or missing Idempotency-Key");
  const actor = getExecuter(res);
  const receipt = ref(database, `transactionReceipts/${actor}/${key}`);
  const fingerprint = createHash("sha256").update(JSON.stringify([req.path, req.body])).digest("hex");

  return atomic(database, async () => {
    const previous = (await get(receipt)).val();
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new RequestConflict("Request ID already used");
      return JSON.parse(previous.response) as T | null;
    }
    const result = (await operation()) ?? null;
    await set(receipt, { fingerprint, response: JSON.stringify(result) });
    return result;
  });
}

function transactionError(res: Response, error: unknown) {
  if (error instanceof RequestConflict || error instanceof WriteConflict) {
    return res.status(409).json({ message: error.message });
  }
  if (error instanceof PersistenceError) {
    console.error("Transaction persistence error", error.cause);
    return res.status(503).json({ message: error.message });
  }
  return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid transaction" });
}

router.post("/purchase", requirePermission("products", "warehouses", "categories"), async (req: Request, res: Response) => {
  try {
    const { newPurchase, newProduct } = req.body;
    if (!newPurchase || !newProduct ||
        !validKey(newPurchase.supplierId) || !validKey(newProduct.warehouse) ||
        !positive(newProduct.quantity) || !positive(newPurchase.exchangeRate) || !validDebt(newPurchase) ||
        typeof newProduct.code !== "string" || !newProduct.code.trim() ||
        newPurchase.code !== newProduct.code || newPurchase.warehouse !== newProduct.warehouse ||
        newPurchase.quantity !== newProduct.quantity ||
        !nonNegative(newProduct.payPrice) || !nonNegative(newProduct.sellPrice)) {
      throw new Error("Purchase payload is incomplete");
    }

    const result = await execute(req, res, () => handlePurchase({
      newPurchase,
      newProduct,
      executer: getExecuter(res),
    }));
    res.json({ message: "Purchase completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/sell", requirePermission("sell_product"), async (req: Request, res: Response) => {
  try {
    const { newSell } = req.body;
    if (!newSell || !Array.isArray(newSell.products) || !newSell.products.length ||
        !newSell.products.every((p: any) => validKey(p?.id) && validKey(p?.warehouse) && positive(p?.qty)) ||
        !positive(newSell.exchangeRate) || !validDebt(newSell) || !validKey(newSell.customerId)) {
      throw new Error("Sell payload is incomplete");
    }
    const result = await execute(req, res, () => handleSell({
      newSell,
      executer: getExecuter(res),
    }));
    res.json({ message: "Sell completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/customerPayment", requirePermission("customers"), async (req: Request, res: Response) => {
  try {
    const { paymentData } = req.body;
    if (!paymentData || !validKey(paymentData.customerId) || !Number.isFinite(paymentData.amount) || !paymentData.amount || !positive(paymentData.exchangeRate)) {
      throw new Error("Customer payment payload is incomplete");
    }
    const result = await execute(req, res, () => customerPayment(paymentData, getExecuter(res)));
    res.json({ message: "Customer payment completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/supplierPayment", requirePermission("suppliers"), async (req: Request, res: Response) => {
  try {
    const { paymentData } = req.body;
    if (!paymentData || !validKey(paymentData.supplierId) || !Number.isFinite(paymentData.amount) || !paymentData.amount || !positive(paymentData.exchangeRate)) {
      throw new Error("Supplier payment payload is incomplete");
    }
    const result = await execute(req, res, () => supplierPayment(paymentData, getExecuter(res)));
    res.json({ message: "Supplier payment completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/SupplierReturn", requirePermission("suppliers"), async (req: Request, res: Response) => {
  try {
    const { newReturn } = req.body;
    if (!newReturn || !validKey(newReturn.supplierId) || !validKey(newReturn.referenceId) ||
        !validKey(newReturn.productId) || !validKey(newReturn.warehouse) || !positive(newReturn.qty) ||
        !nonNegative(newReturn.returnValue) || !validReturnType(newReturn.returnType) ||
        (newReturn.returnType === "part" && (!positive(newReturn.partValue) || newReturn.partValue > newReturn.returnValue))) {
      throw new Error("Invalid supplier return");
    }

    const result = await execute(req, res, () => handleSupplierReturn({
      ...newReturn,
      executer: getExecuter(res),
    }));
    res.json({ message: "Supplier return completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/CustomerReturn", requirePermission("customers"), async (req: Request, res: Response) => {
  try {
    const { newReturn } = req.body;
    if (!newReturn || !validKey(newReturn.customerId) || !validKey(newReturn.referenceId) || !validReturnType(newReturn.returnType)) {
      throw new Error("Invalid customer return");
    }
    const result = await execute(req, res, () => handleCustomerReturn({
      ...newReturn,
      executer: getExecuter(res),
    }));
    res.json({ message: "Customer return completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/warehouseTransfer", requirePermission("warehouses", "products", "categories"), async (req: Request, res: Response) => {
  try {
    const { transferData } = req.body;
    if (!transferData || !validKey(transferData.productId) ||
        !validKey(transferData.oldWarehouse) || !validKey(transferData.newWarehouse) ||
        transferData.oldWarehouse === transferData.newWarehouse || !positive(transferData.quantity) ||
        !nonNegative(transferData.amount) || !positive(transferData.exchangeRate)) {
      throw new Error("Warehouse transfer payload is incomplete");
    }
    const result = await execute(req, res, () => warehouseTransfer({
      ...transferData,
      executer: getExecuter(res),
    }));
    res.json({ message: "Warehouse transfer completed", data: result });
  } catch (error: any) {
    transactionError(res, error);
  }
});

router.post("/afterSellDiscount", requirePermission("sell_product"), async (req: Request, res: Response) => {
  try {
    const { discount, sellId, customerId } = req.body;
    if (!positive(discount) || !validKey(sellId) || !validKey(customerId)) {
      throw new Error("after-sell-discount payload is incomplete");
    }

    await execute(req, res, async () => {
      const invoice = (await get(ref(database, "sells/" + sellId))).val();
      if (!invoice || invoice.customerId !== customerId) throw new Error("Sale invoice does not match customer");
      if (discount > Number(invoice.totalPrice)) throw new Error("Discount exceeds invoice total");
      const result = await addAfterSellDiscountInternal({ sellId, discount });
      if (!result.data) throw new Error("Failed to update sale discount");
      if (!await updateCustomerBalanceInternal(customerId, discount)) throw new Error("Customer not found");

      const executer = getExecuter(res) || "Unknown";
      const operationRef = push(ref(database, "discountOperations"));
      const operationId = operationRef.key || `discount-${Date.now()}`;

      await set(operationRef, {
        id: operationId,
        type: "after_sell_discount",
        executer,
        date: new Date().toLocaleString(),
        referenceId: sellId,
        amount: Number(-discount),
        currency: "USD",
        details: `After-sell discount for sell ${sellId}`,
        customerId,
      });

    });
    res.json({ message: "After-sell discount completed" });
  } catch (error: any) {
    transactionError(res, error);
  }
});

export default router;
