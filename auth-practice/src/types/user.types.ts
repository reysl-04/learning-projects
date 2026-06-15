export type User = {
  id: number;
  email: string;
  password_hash: string;
  hashed_rt: string;
  created_at: Date;
  updated_at: Date;
}

export type CreateUserInput = {
  email: string;
  password_hash: string;
  hashed_rt: string;
};

export type UpdateUserInput = Partial<{
  email: string;
  password_hash: string;
  hashed_rt: string;
}>;