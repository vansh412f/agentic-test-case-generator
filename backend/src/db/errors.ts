export type DatabaseErrorCode = 'DATABASE_UNAVAILABLE';

export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode = 'DATABASE_UNAVAILABLE';

  constructor(cause: unknown) {
    super('Job storage is currently unavailable.', { cause });
    this.name = 'DatabaseError';
  }
}
// Module component implementation.
