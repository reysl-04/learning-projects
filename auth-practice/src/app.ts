import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";


import { usersRouter } from "./routes/users.routes.js";
import { tasksRouter } from "./routes/tasks.routes.js";
import { notFoundHandler } from "./middlewares/not-found.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

import "dotenv/config.js";

export const app: Application = express();

app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    credentials: true,
}));
app.use(morgan("dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/users", usersRouter);
app.use("/tasks", tasksRouter);

app.use(notFoundHandler);
app.use(errorHandler);
