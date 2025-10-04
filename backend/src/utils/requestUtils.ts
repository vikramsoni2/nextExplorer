import type { Request } from 'express';

type MetaBody = Record<string, unknown> | undefined;

export const readMetaField = (req: Request, key: string, fallback = ''): string => {
  const body = req.body as MetaBody;
  if (!body) {
    return fallback;
  }

  const directValue = body[key];
  if (typeof directValue === 'string') {
    return directValue;
  }

  const bracketKey = `meta[${key}]`;
  const bracketValue = body[bracketKey];
  if (typeof bracketValue === 'string') {
    return bracketValue;
  }

  return fallback;
};
