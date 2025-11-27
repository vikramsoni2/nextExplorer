import type { Request } from 'express';

export const readMetaField = <T extends string = string>(
  req: Partial<Request> | any,
  key: string,
  fallback: T | '' = '' as T | '',
): T | '' => {
  if (!req || !req.body) return fallback;

  if (typeof req.body[key] === 'string') {
    return req.body[key] as T;
  }

  const bracketKey = `meta[${key}]`;
  const bracketValue = req.body[bracketKey];
  if (typeof bracketValue === 'string') {
    return bracketValue as T;
  }

  return fallback;
};

module.exports = {
  readMetaField,
};
