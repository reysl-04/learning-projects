import { Router } from "express";
import {
  createTaskHandler,
  deleteTaskHandler,
  listTasks,
  readTask,
  updateTaskHandler,
} from "../controllers/tasks.controller.js";

const tasksRouter = Router({ mergeParams: true });

tasksRouter.get("/", listTasks);
tasksRouter.get("/:taskId/:", readTask);
tasksRouter.post("/", createTaskHandler);
tasksRouter.put("/:taskId", updateTaskHandler);
tasksRouter.delete("/:taskId", deleteTaskHandler);

export default tasksRouter;