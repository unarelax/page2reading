import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "authToken",
      "*.authToken",
      "*.apiKey",
      "*.appSecret",
      "req.headers.authorization",
      "req.body.html",
    ],
    remove: true,
  },
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
});
