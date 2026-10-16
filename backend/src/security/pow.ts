import { createHmac, createHash } from 'node:crypto';
import { createChallenge, verifySolution } from 'altcha-lib/v1';
import { config } from '../config.ts';

export interface PowService {
  createChallenge(): Promise<unknown>; // opaque challenge JSON for the widget
  verifyAndConsume(payload: string): Promise<boolean>; // false on invalid, expired, or replay
}

function powSecret(): string {
  if (process.env.POW_SECRET) return process.env.POW_SECRET;
  if (config.VISITOR_SIGNING_SECRET) return config.VISITOR_SIGNING_SECRET;
  return createHmac('sha256', config.DATABASE_URL).update('pow-v1').digest('hex');
}

class AltchaPowService implements PowService {
  private readonly consumed = new Map<string, number>();

  async createChallenge(): Promise<unknown> {
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes max age
    return createChallenge({
      hmacKey: powSecret(),
      expires,
      maxnumber: 50000,
    });
  }

  async verifyAndConsume(payload: string): Promise<boolean> {
    if (!payload || typeof payload !== 'string' || payload.trim().length === 0) {
      return false;
    }

    const trimmed = payload.trim();
    const hash = createHash('sha256').update(trimmed).digest('hex');
    const now = Date.now();

    // Prune expired replay entries on insert
    this.prune(now);

    // Replay check
    if (this.consumed.has(hash)) {
      return false;
    }

    try {
      const valid = await verifySolution(trimmed, powSecret(), true);
      if (!valid) {
        return false;
      }

      // Mark as consumed for 10 minutes
      this.consumed.set(hash, now + 10 * 60 * 1000);
      return true;
    } catch {
      return false;
    }
  }

  private prune(now: number): void {
    for (const [hash, expiresAt] of this.consumed.entries()) {
      if (now > expiresAt) {
        this.consumed.delete(hash);
      }
    }
  }
}

export const powService: PowService = new AltchaPowService();
