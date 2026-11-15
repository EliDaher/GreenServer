import { requirePermission } from "../controllers/auth.controller";

import express from 'express';
import { getAll, create, getProductById, updateProduct, deleteProduct, getByWarehouse } from '../controllers/products.controller';
const router = express.Router();

router.get('/', getAll);
router.post('/', requirePermission("products"), create);

router.put("/:id", requirePermission("products", "warehouses", "categories"), updateProduct);
router.delete("/:id", requirePermission("products"), deleteProduct);

router.post("/byId", getProductById);

router.post('/getByWarehouse', getByWarehouse)

export default router;
