import { requirePermission } from "../controllers/auth.controller";

import express from 'express';
import { deleteSellById, getAllSells, getSalesByWarehouseAndDate, getSellById, updateSellById } from '../controllers/sells.controller';
const router = express.Router();

router.get('/', getAllSells);

router.get("/:id", getSellById);

router.put("/:id", requirePermission("sell_product"), updateSellById);

router.delete("/:id", requirePermission("sell_product"), deleteSellById);

router.post("/byWarehouseDate", getSalesByWarehouseAndDate);


export default router;
