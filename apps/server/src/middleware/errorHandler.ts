import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    console.error(`[Error] ${req.method} ${req.url}:`, err);

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            ok: false,
            message: err.message,
        });
    }

    return res.status(500).json({
        ok: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'Internal Server Error' 
            : err.message,
    });
};
