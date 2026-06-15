import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import * as authService from "../services/auth.service.js";
import type { AuthenticatedUser, JwtPayload } from "../types/auth.types.js";

const RT_COOKIE = "refresh_token";

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

export async function signUpLocal(req: Request, res: Response, next: NextFunction) {
    try {
        const { email, password } = req.body as { email: string; password: string };
        if (!email || !password) {
            res.status(400).json({ message: "email and password are required" });
            return;
        }

        const tokens = await authService.signupLocal(email, password);
        res.cookie(RT_COOKIE, tokens.refreshToken, cookieOptions);
        res.status(201).json({ accessToken: tokens.accessToken });
    } catch (error) {
        if (error instanceof Error && error.message === "EMAIL_TAKEN") {
            res.status(409).json({ message: "Email already in use" });
            return;
        }
        next(error);
    }
}

export async function signInLocal(req: Request, res: Response, next: NextFunction) {
    try {
        const user = req.user as AuthenticatedUser;
        const tokens = await authService.signinLocal(user.id, user.email);
        res.cookie(RT_COOKIE, tokens.refreshToken, cookieOptions);
        res.json({ accessToken: tokens.accessToken });
    } catch (error) {
        next(error);
    }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
    try {
        const user = req.user as AuthenticatedUser;
        await authService.logoutUser(user.id);
        res.clearCookie(RT_COOKIE, {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
        });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
}

export function getMe(req: Request, res: Response) {
    const user = req.user as AuthenticatedUser;
    res.json({ id: user.id, email: user.email });
}

export async function refreshTokens(req: Request, res: Response, next: NextFunction) {
    try {
        const incomingRt = req.cookies[RT_COOKIE] as string | undefined;
        if (!incomingRt) {
            res.status(401).json({ message: "No refresh token" });
            return;
        }

        let payload: JwtPayload;
        try {
            payload = jwt.verify(incomingRt, process.env.JWT_REFRESH_SECRET as string) as unknown as JwtPayload;
        } catch {
            res.status(401).json({ message: "Invalid or expired refresh token" });
            return;
        }

        const tokens = await authService.refreshTokensForUser(payload.sub, incomingRt);
        res.cookie(RT_COOKIE, tokens.refreshToken, cookieOptions);
        res.json({ accessToken: tokens.accessToken });
    } catch (error) {
        if (error instanceof Error && error.message === "ACCESS_DENIED") {
            res.status(403).json({ message: "Access denied" });
            return;
        }
        next(error);
    }
}
