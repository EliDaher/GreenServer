import { createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { auth, database } from "../firebaseConfig";

export const validUsername = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 64 && value === value.trim() &&
  value.length > 0 && !/[.#$\[\]/\u0000-\u001f\u007f]/.test(value);

export const accountEmail = (username: string) =>
  createHash("sha256").update(username).digest("base64url") + "@inventory.invalid";

async function loadProfile(uid: string) {
  if (!validUsername(uid)) return null;
  const profile = (await database.ref(`users/${uid}`).get()).val();
  if (profile?.role !== "admin" && profile?.role !== "staff") return null;
  return {
    username: uid,
    role: profile.role,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
  };
}

export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.header("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });

  let uid: string;
  try {
    uid = (await auth.verifyIdToken(token, true)).uid;
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  try {
    const profile = await loadProfile(uid);
    if (!profile) return res.status(403).json({ error: "Forbidden" });
    res.locals.user = profile;
    res.locals.executer = profile.username;
    next();
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  const { username, password } = req.body ?? {};
  if (!validUsername(username) || typeof password !== "string" || !password || password.length > 4096) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  try {
    const apiKey = process.env.FIREBASE_apiKey;
    if (!apiKey) throw new Error("Missing FIREBASE_apiKey");
    const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const origin = emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
    const result = await fetch(`${origin}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountEmail(username), password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (result.status === 429) return res.status(429).json({ error: "Too many attempts" });
    if (result.status === 400) return res.status(401).json({ error: "Invalid credentials" });
    if (!result.ok) throw new Error("Firebase Authentication unavailable");

    const { idToken, localId } = await result.json() as { idToken: string; localId: string };
    const user = localId === username ? await loadProfile(localId) : null;
    if (!user) return res.status(403).json({ error: "Forbidden" });
    return res.json({ message: "تم تسجيل الدخول بنجاح", token: idToken, user });
  } catch (error) {
    next(error);
  }
}

export function requirePermission(...permissions: string[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;
    if (user?.role === "admin" || permissions.some((permission) => user?.permissions.includes(permission))) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden" });
  };
}
