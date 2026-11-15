import { requirePermission } from "../controllers/auth.controller";


import express from 'express';
import { getAll, create, getCustomerById, updateCustomerInfo } from '../controllers/customer.controller';
const router = express.Router();

router.get('/', getAll);
router.post('/', requirePermission("customers"), create);

router.post('/byId', getCustomerById);

router.put("/:id", requirePermission("customers"), updateCustomerInfo);

export default router;
