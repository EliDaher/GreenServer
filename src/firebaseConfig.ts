import "dotenv/config";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";

const app = initializeApp({
  projectId: process.env.FIREBASE_projectId,
  databaseURL: process.env.FIREBASE_databaseURL,
});

export const database = getDatabase(app);
export const auth = getAuth(app);
