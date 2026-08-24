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

/** Provider may have accepted a non-idempotent send; automatic retry is unsafe. */
export class DeliveryUnknownError extends Error {constructor(message="Provider delivery result is unknown",options?:ErrorOptions){super(message,options);this.name="DeliveryUnknownError";}}

/** A recipient was never cached by MTProto and no persisted InputPeer is available. */
export class TelegramRecipientResolutionError extends Error {constructor(){super("Telegram recipient is unavailable; wait for a new incoming message or start a new conversation");this.name="TelegramRecipientResolutionError";}}
