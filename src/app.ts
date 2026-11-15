import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import routes from "./routes/index";
import morgan from "morgan";
import { database } from "./firebaseConfig";

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8080"))
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "256kb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/ready", async (_req, res) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      database.ref("warehouses").limitToFirst(1).get(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Database timeout")), 3000);
      }),
    ]);
    res.json({ status: "ready" });
  } catch (error) {
    console.error("Readiness check failed", error);
    res.status(503).json({ status: "unavailable" });
  } finally {
    clearTimeout(timeout);
  }
});
app.use("/api", routes);
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  console.error("Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};
app.use(handleError);

export default app;
