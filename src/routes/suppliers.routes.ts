import { requirePermission } from "../controllers/auth.controller";

import express from 'express';
import { getAll, create, getSupplierById, updateSupplierInfo } from '../controllers/suppliers.controller';
const router = express.Router();

router.get('/', getAll);
router.post('/', requirePermission("suppliers"), create);

router.put("/:id", requirePermission("suppliers"), updateSupplierInfo);

router.post('/byId', getSupplierById);

export default router;
