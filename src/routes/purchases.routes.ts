import { requirePermission } from "../controllers/auth.controller";

import express from 'express';
import { getAllPurchases, createPurchase } from '../controllers/purchases.controller';
const router = express.Router();

router.get('/', getAllPurchases);
router.post('/', requirePermission("products"), createPurchase);

export default router;
