import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import bcrypt from "bcrypt";
import { findUserByEmail, findUserById } from "../repositories/users.repository.js";
import type { JwtPayload } from "../types/auth.types.js";

passport.use(
    new LocalStrategy(
        { usernameField: "email", passwordField: "password" },
        async (email, password, done) => {
            try {
                const user = await findUserByEmail(email);
                if (!user) return done(null, false, { message: "Invalid credentials" });

                const valid = await bcrypt.compare(password, user.password_hash);
                if (!valid) return done(null, false, { message: "Invalid credentials" });

                return done(null, { id: user.id, email: user.email });
            } catch (err) {
                return done(err);
            }
        }
    )
);

passport.use(
    new JwtStrategy(
        {
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: process.env.JWT_ACCESS_SECRET as string,
        },
        async (payload: JwtPayload, done) => {
            try {
                const user = await findUserById(payload.sub);
                if (!user) return done(null, false);
                return done(null, { id: user.id, email: user.email });
            } catch (err) {
                return done(err);
            }
        }
    )
);

export default passport;
