export default interface User {
  id: number;
  email: string;
  password_hash: string;
  hashed_rt: string;
  created_at: Date;
  updated_at: Date;
}