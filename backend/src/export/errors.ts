export type ExportErrorCode = 'INVALID_EXPORT_FILE' | 'EXPORT_FAILED';

export class ExportError extends Error {
  constructor(public readonly code: ExportErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ExportError';
  }
}
// Module component implementation.
