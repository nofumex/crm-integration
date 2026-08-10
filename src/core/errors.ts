export class ReadOnlyViolationError extends Error {
  constructor(method: string, url: string) {
    super(`Blocked ${method.toUpperCase()} request in amoCRM read-only mode: ${url}`);
    this.name = "ReadOnlyViolationError";
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}
