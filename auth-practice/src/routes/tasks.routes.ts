import { Router } from "express";
import {
  createTaskHandler,
  deleteTaskHandler,
  listTasks,
  readTask,
  updateTaskHandler,
} from "../controllers/tasks.controller.js";

export const tasksRouter = Router();

tasksRouter.get("/", listTasks);
tasksRouter.get("/:id", readTask);
tasksRouter.post("/", createTaskHandler);
tasksRouter.put("/:id", updateTaskHandler);
tasksRouter.delete("/:id", deleteTaskHandler);
