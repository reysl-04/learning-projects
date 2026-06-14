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

export async function listUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (error) {
    next(error);
  }
}

export async function readUser(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params.id as string, 10);
    const user = await getUserById(id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
}

export async function createUserHandler(
  req: Request<unknown, unknown, CreateUserInput>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { email, password_hash, hashed_rt } = req.body;

    if (!email || !password_hash || !hashed_rt) {
      res.status(400).json({ message: "email, password_hash, and hashed_rt are required" });
      return;
    }

    const user = await createUser({ email, password_hash, hashed_rt });
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
}

export async function updateUserHandler(
  req: Request<{ id: string }, unknown, UpdateUserInput>,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = parseInt(req.params.id as string, 10);
    const updatedUser = await updateUser(id, req.body);

    if (!updatedUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(updatedUser);
  } catch (error) {
    next(error);
  }
}

export async function deleteUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = parseInt(req.params.id as string, 10);
    const removed = await deleteUser(id);

    if (!removed) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
