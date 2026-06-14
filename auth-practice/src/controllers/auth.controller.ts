import type { Request, Response } from "express"

export function createSession(req: Request, res: Response) {
    const { email, password } = req.body
}
