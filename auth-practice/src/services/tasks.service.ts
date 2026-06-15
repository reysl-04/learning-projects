import { randomUUID } from "node:crypto";

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  completed?: boolean;
}

const tasks: Task[] = [
  {
    id: randomUUID(),
    title: "Sample task",
    description: "Seeded task for the boilerplate",
    completed: false,
  },
];

export function getTasks() {
  return tasks;
}

export function getTaskById(id: string) {
  return tasks.find((task) => task.id === id);
}

export function createTask(input: CreateTaskInput) {
  const task: Task = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    completed: false,
  };

  tasks.push(task);
  return task;
}

export function updateTask(id: string, input: UpdateTaskInput) {
  const task = getTaskById(id);

  if (!task) {
    return undefined;
  }

  if (typeof input.title === "string") {
    task.title = input.title;
  }

  if (typeof input.description === "string") {
    task.description = input.description;
  }

  if (typeof input.completed === "boolean") {
    task.completed = input.completed;
  }

  return task;
}

export function deleteTask(id: string) {
  const taskIndex = tasks.findIndex((task) => task.id === id);

  if (taskIndex < 0) {
    return false;
  }

  tasks.splice(taskIndex, 1);
  return true;
}
