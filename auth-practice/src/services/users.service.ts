import * as usersRepo from "../repositories/users.repository.js";
import {User, CreateUserInput, UpdateUserInput} from "../types/user.types.js"


export async function getUsers(): Promise<User[]> {
  return usersRepo.findAllUsers();
}

export async function getUserById(id: number): Promise<User | null> {
  return usersRepo.findUserById(id);
}

export async function createUser(input: CreateUserInput): Promise<User> {
  return usersRepo.createUser(input);
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<User | null> {
  return usersRepo.updateUser(id, input);
}

export async function deleteUser(id: number): Promise<number | null> {
  return usersRepo.deleteUser(id);
}
