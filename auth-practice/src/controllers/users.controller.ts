import type { NextFunction, Request, Response } from "express";
import {
  createUser,
  deleteUser,
  getUserById,
  getUsers,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
} from "../services/users.service.js";

export function listUsers(_req: Request, res: Response) {
  res.json(getUsers());
}

export function readUser(req: Request, res: Response) {
  const user = getUserById(req.params.id as string);

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json(user);
}

export function createUserHandler(
  req: Request<unknown, unknown, CreateUserInput>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      res.status(400).json({ message: "name and email are required" });
      return;
    }

    res.status(201).json(createUser({ name, email }));
  } catch (error) {
    next(error);
  }
}

export function updateUserHandler(
  req: Request<{ id: string }, unknown, UpdateUserInput>,
  res: Response,
  next: NextFunction,
) {
  try {
    const updatedUser = updateUser(req.params.id, req.body);

    if (!updatedUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(updatedUser);
  } catch (error) {
    next(error);
  }
}

export function deleteUserHandler(req: Request, res: Response) {
  const removed = deleteUser(req.params.id as string);

  if (!removed) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.status(204).send();
}
