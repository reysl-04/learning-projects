import type { Request, Response, NextFunction } from "express";
import passportInstance from "../config/passport.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    passportInstance.authenticate(
        "jwt",
        { session: false },
        (err: unknown, user: Express.User | false) => {
            if (err) return next(err);
            if (!user) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            req.user = user;
            next();
        }
    )(req, res, next);
}

export function authenticateLocal(req: Request, res: Response, next: NextFunction): void {
    passportInstance.authenticate(
        "local",
        { session: false },
        (err: unknown, user: Express.User | false, info?: { message: string }) => {
            if (err) return next(err);
            if (!user) {
                res.status(401).json({ message: info?.message ?? "Invalid credentials" });
                return;
            }
            req.user = user;
            next();
        }
    )(req, res, next);
}
