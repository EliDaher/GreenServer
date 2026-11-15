import { requirePermission, requireSession } from "../controllers/auth.controller";
import { Router } from "express";
import authRoutes from "./auth.routes";
import productsRouter from "./products.routes";
import suppliersRouter from "./suppliers.routes";
import purchasesRouter from "./purchases.routes";
import transactionsRouter from "./transactions.routes";
import paymentsRouter from "./payments.routes";
import customersRouter from "./customer.routes";
import sellsRouter from "./sells.routes";
import warehousesRouter from "./warehouse.routes";
import usersRouter from "./users.routes";
import reportsRouter from "./reports.routes";


const router = Router();

router.use("/auth", authRoutes);
router.use(requireSession);

router.use("/products", requirePermission("products", "sell_product", "warehouses", "categories"), productsRouter);
router.use("/suppliers", requirePermission("suppliers", "products", "dashboard", "warehouses", "categories"), suppliersRouter);
router.use("/purchases", requirePermission("products", "suppliers", "dashboard", "financial_statement"), purchasesRouter);
router.use("/transactions", transactionsRouter);
router.use("/payments", requirePermission("financial_statement", "dashboard"), paymentsRouter);
router.use("/customers", requirePermission("customers", "sell_product", "dashboard"), customersRouter);
router.use("/sells", requirePermission("sell_product", "dashboard", "warehouses", "financial_statement"), sellsRouter);
router.use("/warehouses", requirePermission("warehouses", "products", "sell_product", "suppliers", "customers", "categories"), warehousesRouter);
router.use("/users", usersRouter);
router.use("/reports", requirePermission("financial_statement", "dashboard"), reportsRouter);

export default router;
