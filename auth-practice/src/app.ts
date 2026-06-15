import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { usersRouter } from "./routes/users.routes.js";
import tasksRouter from "./routes/tasks.routes.js";
import authRouter from "./routes/auth.routes.js";
import passportInstance from "./config/passport.js";
import { notFoundHandler } from "./middlewares/not-found.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

import "dotenv/config.js";

export const app: Application = express();

app.use(helmet());
app.use(cors({
    origin: (origin, callback) => callback(null, origin ?? "null"),
    credentials: true,
}));
app.use(morgan("dev"));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passportInstance.initialize());

app.use(express.static("."));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/tasks", tasksRouter);

app.use(notFoundHandler);
app.use(errorHandler);
