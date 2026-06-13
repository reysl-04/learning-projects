import type { NextFunction, Request, Response } from "express";
import {
  createTask,
  deleteTask,
  getTaskById,
  getTasks,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "../services/tasks.service.js";

export function listTasks(_req: Request, res: Response) {
  res.json(getTasks());
}

export function readTask(req: Request, res: Response) {
  const task = getTaskById(req.params.id as string);

  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  res.json(task);
}

export function createTaskHandler(
  req: Request<unknown, unknown, CreateTaskInput>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { title, description } = req.body;

    if (!title) {
      res.status(400).json({ message: "title is required" });
      return;
    }

    res.status(201).json(createTask({ title, description }));
  } catch (error) {
    next(error);
  }
}

export function updateTaskHandler(
  req: Request<{ id: string }, unknown, UpdateTaskInput>,
  res: Response,
  next: NextFunction,
) {
  try {
    const updatedTask = updateTask(req.params.id, req.body);

    if (!updatedTask) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
}

export function deleteTaskHandler(req: Request, res: Response) {
  const removed = deleteTask(req.params.id as string);

  if (!removed) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  res.status(204).send();
}
