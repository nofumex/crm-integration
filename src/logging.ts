import pino from "pino";

export function createLogger(level = "info") {
  return pino({ level, redact: {
    paths: ["req.headers.authorization", "headers.authorization", "accessToken", "token", "apiHash", "session", "channelSecret", "appSecret", "password", "phoneCode"],
    censor: "[REDACTED]",
  } });
}
