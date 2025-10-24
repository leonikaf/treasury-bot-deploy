import { pino } from "pino";

import { LOG_LEVEL } from "../config.js";

export const logger = pino({
  level: LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
});

export type Logger = typeof logger;
