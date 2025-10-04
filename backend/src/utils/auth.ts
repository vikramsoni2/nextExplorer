import type { Request } from 'express';

const extractBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }

  const [scheme, value] = authorizationHeader.split(' ');
  if (!value || !/^Bearer$/i.test(scheme)) {
    return null;
  }

  return value.trim() || null;
};

export const extractToken = (req: Request): string | null => {
  const headerToken = extractBearerToken(req.headers?.authorization as string | undefined);
  if (headerToken) {
    return headerToken;
  }

  const customHeaderToken = req.headers?.['x-access-token'];
  if (typeof customHeaderToken === 'string') {
    const trimmed = customHeaderToken.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  const bodyToken = (req.body as Record<string, unknown> | undefined)?.token;
  if (typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }

  return null;
};
