import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { findUserByEmail, findUserById, createUser } from "../repositories/users.repository.js";
import { storeHashedRt, clearHashedRt } from "../repositories/auth.repository.js";
import type { Tokens, JwtPayload } from "../types/auth.types.js";

const BCRYPT_ROUNDS = 12;

function signAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, process.env.JWT_ACCESS_SECRET as string, {
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN) as jwt.SignOptions["expiresIn"],
    });
}

function signRefreshToken(payload: JwtPayload): string {
    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN) as jwt.SignOptions["expiresIn"],
    });
}

function generateTokens(userId: number, email: string): Tokens {
    const payload: JwtPayload = { sub: userId, email };
    return {
        accessToken: signAccessToken(payload),
        refreshToken: signRefreshToken(payload),
    };
}

export async function signupLocal(email: string, password: string): Promise<Tokens> {
    const existing = await findUserByEmail(email);
    if (existing) throw new Error("EMAIL_TAKEN");

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await createUser({ email, password_hash, hashed_rt: "" });

    const tokens = generateTokens(user.id, user.email);
    const hashed_rt = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    await storeHashedRt(user.id, hashed_rt);

    return tokens;
}

export async function signinLocal(userId: number, email: string): Promise<Tokens> {
    const tokens = generateTokens(userId, email);
    const hashed_rt = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    await storeHashedRt(userId, hashed_rt);
    return tokens;
}

export async function logoutUser(userId: number): Promise<void> {
    await clearHashedRt(userId);
}

export async function refreshTokensForUser(userId: number, incomingRt: string): Promise<Tokens> {
    const user = await findUserById(userId);
    if (!user || !user.hashed_rt) throw new Error("ACCESS_DENIED");

    const rtMatches = await bcrypt.compare(incomingRt, user.hashed_rt);
    if (!rtMatches) throw new Error("ACCESS_DENIED");

    const tokens = generateTokens(user.id, user.email);
    const hashed_rt = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    await storeHashedRt(user.id, hashed_rt);
    return tokens;
}
