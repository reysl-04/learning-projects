# auth-practice

A learning project implementing JWT authentication with refresh token rotation using Node.js, Express, TypeScript, and PostgreSQL.

## Stack

- **Runtime:** Node.js (ESM)
- **Framework:** Express
- **Language:** TypeScript (strict)
- **Database:** PostgreSQL via `pg`
- **Auth:** Passport.js (local + JWT strategies), `jsonwebtoken`, `bcrypt`

## Architecture

```
src/
├── config/
│   └── passport.ts          # LocalStrategy + JwtStrategy definitions
├── controllers/
│   ├── auth.controller.ts   # Signup, signin, logout, refresh, me
│   └── users.controller.ts  # User CRUD
├── middlewares/
│   ├── auth.middleware.ts   # requireAuth, authenticateLocal
│   ├── error.middleware.ts
│   └── not-found.middleware.ts
├── repositories/
│   ├── auth.repository.ts   # storeHashedRt, clearHashedRt
│   └── users.repository.ts  # User DB queries
├── routes/
│   ├── auth.routes.ts
│   └── users.routes.ts
├── services/
│   ├── auth.service.ts      # Token generation, signup/signin/logout/refresh logic
│   └── users.service.ts
├── types/
│   ├── auth.types.ts        # Tokens, JwtPayload, AuthenticatedUser
│   ├── express.d.ts         # req.user type declaration merge
│   └── user.types.ts
└── db/
    ├── pool.ts              # PostgreSQL connection pool
    ├── migrate.ts           # Migration runner
    └── migrations/
        ├── 001_create_users.sql
        └── 002_update_users.sql
```

## Auth Flow

**Access Token (AT)** — short-lived (15m), returned in response body, sent in `Authorization: Bearer` header.

**Refresh Token (RT)** — long-lived (7d), stored in an httpOnly cookie, hash stored in DB.

```
Signup/Signin  →  generate AT + RT  →  hash RT  →  store hash in DB  →  return AT + set RT cookie
Protected req  →  verify AT signature  →  no DB hit
AT expires     →  client calls /auth/local/refresh  →  verify RT cookie  →  rotate tokens
Logout         →  clear hashed_rt in DB  →  clear cookie
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/local/signup` | — | Create account, receive tokens |
| POST | `/auth/local/signin` | — | Sign in, receive tokens |
| POST | `/auth/local/logout` | AT | Clear session |
| POST | `/auth/local/refresh` | RT cookie | Rotate tokens |
| GET | `/auth/me` | AT | Get current user |
| GET | `/users` | — | List users |
| GET | `/users/:id` | — | Get user |

## Not Implemented

- **RBAC** No roles or permission system yet: All authenticated users have equal access

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Create `.env`**
```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
JWT_ACCESS_SECRET=<random-64-byte-hex>
JWT_REFRESH_SECRET=<random-64-byte-hex>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**3. Run migrations**
```bash
npm run migrate
```

**4. Start dev server**
```bash
npm run dev
```

Server runs on `http://localhost:3000`.

## Demo UI

Open `http://localhost:3000/main.html` to see a visual demo of the AT/RT flow — including live token expiry countdown and a request log showing the automatic refresh cycle.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run migrate` | Run pending DB migrations |
