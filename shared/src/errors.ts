/**
 * Shared error contract (ARCHITECTURE.md §6.2).
 *
 * Every API error, from every endpoint, has exactly this shape:
 *
 * {
 *   "error": {
 *     "code": "VALIDATION_FAILED",
 *     "message": "The submitted data is invalid.",
 *     "details": [ { "field": "email", "issue": "Invalid email address" } ],
 *     "requestId": "req_…"
 *   }
 * }
 *
 * `code` is a stable machine string from the catalogue below. `message` is
 * safe and human-readable: it never contains SQL errors, stack traces, file
 * paths, or whether an email address exists.
 */

export interface FieldIssue {
  field: string;
  issue: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: FieldIssue[];
  requestId: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

interface ErrorCatalogueEntry {
  httpStatus: number;
  defaultMessage: string;
}

/**
 * The stable error-code catalogue. HTTP mapping per ARCHITECTURE.md §6.2:
 * 400 validation, 401 unauthenticated, 403 not permitted, 404 not found
 * (also masks other customers' resources), 409 state/uniqueness conflict,
 * 422 business-rule failure, 429 rate limited, 500 internal,
 * 503 dependency unavailable (readiness).
 */
export const ERROR_CATALOGUE = {
  VALIDATION_FAILED: {
    httpStatus: 400,
    defaultMessage: "The submitted data is invalid.",
  },
  UNAUTHENTICATED: {
    httpStatus: 401,
    defaultMessage: "Authentication is required.",
  },
  FORBIDDEN: {
    httpStatus: 403,
    defaultMessage: "You do not have permission to perform this action.",
  },
  NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: "The requested resource was not found.",
  },
  CONFLICT: {
    httpStatus: 409,
    defaultMessage: "The request conflicts with the current state of the resource.",
  },
  PAYLOAD_TOO_LARGE: {
    httpStatus: 413,
    defaultMessage: "The request body is too large.",
  },
  OTP_EXPIRED: {
    httpStatus: 400,
    defaultMessage: "The verification code has expired.",
  },
  OTP_ATTEMPTS_EXCEEDED: {
    httpStatus: 429,
    defaultMessage: "Too many incorrect verification attempts.",
  },
  RATE_LIMITED: {
    httpStatus: 429,
    defaultMessage: "Too many requests. Please try again later.",
  },
  INSUFFICIENT_STOCK: {
    httpStatus: 422,
    defaultMessage: "Insufficient stock for one or more items.",
  },
  INVALID_STATE_TRANSITION: {
    httpStatus: 422,
    defaultMessage: "This action is not allowed in the resource's current state.",
  },
  SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    defaultMessage: "The service is temporarily unavailable.",
  },
  INTERNAL: {
    httpStatus: 500,
    defaultMessage: "An unexpected error occurred.",
  },
} as const satisfies Record<string, ErrorCatalogueEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export const ERROR_CODES = Object.keys(ERROR_CATALOGUE) as ErrorCode[];

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOGUE, value);
}

/**
 * Application error carrying a catalogue code. Platform-neutral: the server
 * throws these from services/controllers and its error middleware renders
 * them with `errorResponseFor`; the frontend may use the class to type
 * caught API errors.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: FieldIssue[];

  constructor(
    code: ErrorCode,
    message?: string,
    details?: FieldIssue[],
    options?: { cause?: unknown },
  ) {
    super(message ?? ERROR_CATALOGUE[code].defaultMessage, options);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = ERROR_CATALOGUE[code].httpStatus;
    this.details = details;
  }

  static validation(details: FieldIssue[], message?: string): AppError {
    return new AppError("VALIDATION_FAILED", message, details);
  }

  static unauthenticated(message?: string): AppError {
    return new AppError("UNAUTHENTICATED", message);
  }

  static forbidden(message?: string): AppError {
    return new AppError("FORBIDDEN", message);
  }

  static notFound(message?: string): AppError {
    return new AppError("NOT_FOUND", message);
  }

  static conflict(message?: string): AppError {
    return new AppError("CONFLICT", message);
  }

  static internal(cause?: unknown): AppError {
    return new AppError("INTERNAL", undefined, undefined, { cause });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Render any thrown value as the standard error envelope. Unknown errors
 * collapse to INTERNAL with the generic catalogue message — internals are
 * never leaked to clients.
 */
export function errorResponseFor(
  err: unknown,
  requestId: string,
): { status: number; body: ApiErrorResponse } {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
          requestId,
        },
      },
    };
  }
  return {
    status: ERROR_CATALOGUE.INTERNAL.httpStatus,
    body: {
      error: {
        code: "INTERNAL",
        message: ERROR_CATALOGUE.INTERNAL.defaultMessage,
        requestId,
      },
    },
  };
}

/**
 * Map Zod-style issues (structural type, so this module does not depend on a
 * specific Zod version's exported types) to envelope `details` entries.
 */
export function fieldIssuesFromIssues(
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>,
): FieldIssue[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
    issue: issue.message,
  }));
}
