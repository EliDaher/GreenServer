import { requirePermission } from "../controllers/auth.controller";
import express from "express";
import * as warehouseController from "../controllers/warehouses.controller";

const router = express.Router();

router.get("/", warehouseController.getAll);

router.post("/", requirePermission("warehouses"), warehouseController.create);



export default router;
