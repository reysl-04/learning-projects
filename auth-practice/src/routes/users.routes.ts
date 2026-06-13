import { Router } from "express";
import tasksRouter from "./tasks.routes.js";

import {
  createUserHandler,
  deleteUserHandler,
  readUser,
  updateUserHandler,
} from "../controllers/users.controller.js";

export const usersRouter = Router();

usersRouter.get("/:id", readUser);
usersRouter.use("/:id/tasks", tasksRouter);

usersRouter.post("/", createUserHandler);
usersRouter.put("/:id", updateUserHandler);
usersRouter.delete("/:id", deleteUserHandler);
