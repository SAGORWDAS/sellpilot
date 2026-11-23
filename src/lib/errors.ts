export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class Unauthorized extends AppError {
  constructor(message = 'Not signed in') {
    super(message, 401, 'unauthorized');
  }
}

export class Forbidden extends AppError {
  constructor(message = 'Not permitted') {
    super(message, 403, 'forbidden');
  }
}

export class NotFound extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'not_found');
  }
}

export class Conflict extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'conflict');
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message, 422, 'validation_error');
  }
}

export class RateLimited extends AppError {
  constructor(message = 'Too many attempts') {
    super(message, 429, 'rate_limited');
  }
}

export class BudgetExceeded extends AppError {
  constructor(message = 'Campaign AI budget reached') {
    super(message, 402, 'budget_exceeded');
  }
}