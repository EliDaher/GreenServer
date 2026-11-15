import { NextFunction, Request, Response } from "express";
import { get, ref, remove, set } from "../database";
import { auth, database } from "../firebaseConfig";
import { getAllOperations } from "../services/operations.service";

import { accountEmail, validUsername } from "./auth.controller";

const MODULE_PERMISSIONS = [
  "dashboard",
  "products",
  "sell_product",
  "suppliers",
  "customers",
  "financial_statement",
  "warehouses",
  "categories",
  "users",
] as const;

type ModulePermission = (typeof MODULE_PERMISSIONS)[number];

type UserRecord = {
  username: string;
  role: "admin" | "staff";
  permissions: ModulePermission[];
  createdAt: string;
  updatedAt: string;
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};

const asString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizePermissions = (permissions: unknown): ModulePermission[] => {
  if (!Array.isArray(permissions)) {
    return [];
  }

  const filtered = permissions.filter(
    (permission): permission is ModulePermission =>
      typeof permission === "string" &&
      (MODULE_PERMISSIONS as readonly string[]).includes(permission)
  );

  return Array.from(new Set(filtered));
};

const normalizeRole = (role: unknown): "admin" | "staff" | null => {
  if (role === "admin" || role === "staff") {
    return role;
  }
  return null;
};

export const requireAdminUser = (_req: Request, res: Response, next: NextFunction) => {
  if (res.locals.user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};

export const listUsers = async (_req: Request, res: Response) => {
  try {
    const snapshot = await get(ref(database, "users"));
    if (!snapshot.exists()) {
      return res.json([]);
    }

    const usersObject = asRecord(snapshot.val());
    const users = Object.entries(usersObject).map(([key, value]) => {
      const user = asRecord(value);
      return {
        username: asString(user.username) || key,
        role: asString(user.role) || "staff",
        permissions: normalizePermissions(user.permissions),
        createdAt: asString(user.createdAt) || "",
        updatedAt: asString(user.updatedAt) || "",
      };
    });

    users.sort((a, b) => a.username.localeCompare(b.username));
    return res.json(users);
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ error: "Failed to list users" });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const username = asString(req.body?.username);
    const password = req.body?.password;
    const role = normalizeRole(req.body?.role);

    if (!validUsername(username) || typeof password !== "string" || password.length < 6 || !role) {
      return res
        .status(400)
        .json({ error: "username, password and valid role are required" });
    }

    const userRef = ref(database, `users/${username}`);
    const existingUser = await get(userRef);
    if (existingUser.exists()) {
      return res.status(400).json({ error: "User already exists" });
    }

    const permissions =
      role === "admin"
        ? [...MODULE_PERMISSIONS]
        : normalizePermissions(req.body?.permissions);
    const now = new Date().toLocaleString();

    const userToSave: UserRecord = {
      username,
      role,
      permissions,
      createdAt: now,
      updatedAt: now,
    };

    await auth.createUser({ uid: username, email: accountEmail(username), password });
    try {
      await set(userRef, userToSave);
    } catch (error) {
      await auth.deleteUser(username);
      throw error;
    }
    return res.status(201).json({
      message: "User created successfully",
      user: {
        username: userToSave.username,
        role: userToSave.role,
        permissions: userToSave.permissions,
        createdAt: userToSave.createdAt,
        updatedAt: userToSave.updatedAt,
      },
    });
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({ error: "Failed to create user" });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const username = asString(req.params.username);
    if (!validUsername(username)) {
      return res.status(400).json({ error: "username is required" });
    }

    const userRef = ref(database, `users/${username}`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const existing = asRecord(snapshot.val()) as UserRecord;

    let role: "admin" | "staff" = existing.role;
    if (req.body?.role != null) {
      const normalizedRole = normalizeRole(req.body.role);
      if (!normalizedRole) {
        return res.status(400).json({ error: "Invalid role value" });
      }
      role = normalizedRole;
    }

    const password = req.body?.password;
    if (password != null && (typeof password !== "string" || password.length < 6)) {
      return res.status(400).json({ error: "Password must contain at least six characters" });
    }

    const permissions =
      role === "admin"
        ? [...MODULE_PERMISSIONS]
        : req.body?.permissions != null
        ? normalizePermissions(req.body.permissions)
        : normalizePermissions(existing.permissions);

    const updated: UserRecord = {
      username,
      role,
      permissions,
      createdAt: asString(existing.createdAt) || new Date().toLocaleString(),
      updatedAt: new Date().toLocaleString(),
    };

    if (password != null) {
      await auth.updateUser(username, { password });
      await auth.revokeRefreshTokens(username);
    }
    await set(userRef, updated);

    return res.json({
      message: "User updated successfully",
      user: {
        username: updated.username,
        role: updated.role,
        permissions: updated.permissions,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const username = asString(req.params.username);
    if (!validUsername(username)) {
      return res.status(400).json({ error: "username is required" });
    }

    const currentExecuter = asString(res.locals.executer);
    if (currentExecuter === username) {
      return res.status(400).json({ error: "You cannot delete your own user" });
    }

    const userRef = ref(database, `users/${username}`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    await remove(userRef);
    await auth.deleteUser(username);
    return res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ error: "Failed to delete user" });
  }
};

export const getOperations = async (req: Request, res: Response) => {
  try {
    const operations = await getAllOperations();
    const limit = Number(req.query.limit);
    const normalizedLimit =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : operations.length;

    return res.json(operations.slice(0, normalizedLimit));
  } catch (error) {
    console.error("Get operations error:", error);
    return res.status(500).json({ error: "Failed to load operations" });
  }
};

export const getUserOperations = async (req: Request, res: Response) => {
  try {
    const username = asString(req.params.username);
    if (!validUsername(username)) {
      return res.status(400).json({ error: "username is required" });
    }

    const operations = await getAllOperations();
    const userOperations = operations.filter(
      (operation) => operation.executer === username
    );

    return res.json(userOperations);
  } catch (error) {
    console.error("Get user operations error:", error);
    return res.status(500).json({ error: "Failed to load user operations" });
  }
};
