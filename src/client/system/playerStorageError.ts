export type BrowserPlayerStorageErrorKind = "unavailable" | "conflict" | "corrupt" | "unauthorized";

export class BrowserPlayerStorageError extends Error {
  readonly kind: BrowserPlayerStorageErrorKind;

  constructor(kind: BrowserPlayerStorageErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "BrowserPlayerStorageError";
    this.kind = kind;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function isBrowserPlayerStorageError(error: unknown): error is BrowserPlayerStorageError {
  return error instanceof BrowserPlayerStorageError;
}
