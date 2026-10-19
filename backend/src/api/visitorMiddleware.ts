import type { NextFunction, Request, Response } from 'express';
import { mintVisitorToken, parseVisitorToken } from '../security/visitor.ts';

declare global {
  namespace Express {
    interface Request {
      visitorId: string;
    }
  }
}

export function visitorMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = parseVisitorToken(req.header('x-visitor-id'));
  if (existing) {
    req.visitorId = existing;
  } else {
    const minted = mintVisitorToken();
    req.visitorId = minted.visitorId;
    res.setHeader('x-visitor-id', minted.token);
  }
  next();
}
// Module component implementation.
