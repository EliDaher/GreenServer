import { requirePermission } from "../controllers/auth.controller";

import express from 'express';
import { createPayment, deletePayment, getAll, getMonthPayments } from '../controllers/payments.controller';
const router = express.Router();

router.get('/', getAll);

router.get('/month', getMonthPayments);

router.post('/create', requirePermission("financial_statement", "dashboard"), createPayment);

router.delete('/:id', requirePermission("financial_statement"), deletePayment);

export default router;
