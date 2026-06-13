import { Router } from "express";
import {
  createUserHandler,
  deleteUserHandler,
  listUsers,
  readUser,
  updateUserHandler,
} from "../controllers/users.controller.js";

export const usersRouter = Router();

usersRouter.get("/", listUsers);
usersRouter.get("/:id", readUser);
usersRouter.post("/", createUserHandler);
usersRouter.put("/:id", updateUserHandler);
usersRouter.delete("/:id", deleteUserHandler);
