import { Router } from "express";
import { signUpLocal, signInLocal, logout, refreshTokens, getMe } from "../controllers/auth.controller.js";
import { authenticateLocal, requireAuth } from "../middlewares/auth.middleware.js";

const authRouter = Router();

authRouter.post("/local/signup", signUpLocal);
authRouter.post("/local/signin", authenticateLocal, signInLocal);
authRouter.post("/local/logout", requireAuth, logout);
authRouter.post("/local/refresh", refreshTokens);
authRouter.get("/me", requireAuth, getMe);

export default authRouter;
