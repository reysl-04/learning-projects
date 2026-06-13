import { randomUUID } from "node:crypto";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

const users: User[] = [
  {
    id: randomUUID(),
    name: "Sample User",
    email: "user@example.com",
  },
];

export function getUsers() {
  return users;
}

export function getUserById(id: string) {
  return users.find((user) => user.id === id);
}

export function createUser(input: CreateUserInput) {
  const user: User = {
    id: randomUUID(),
    name: input.name,
    email: input.email,
  };

  users.push(user);
  return user;
}

export function updateUser(id: string, input: UpdateUserInput) {
  const user = getUserById(id);

  if (!user) {
    return undefined;
  }

  if (typeof input.name === "string") {
    user.name = input.name;
  }

  if (typeof input.email === "string") {
    user.email = input.email;
  }

  return user;
}

export function deleteUser(id: string) {
  const userIndex = users.findIndex((user) => user.id === id);

  if (userIndex < 0) {
    return false;
  }

  users.splice(userIndex, 1);
  return true;
}
