import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Async handler wrapper for Express routes that propagates rejections to Express error middleware.
 */
type AsyncRouteHandler = (req: Request | any, res: Response | any, next: NextFunction) => Promise<unknown> | unknown;

const asyncHandler = (fn: AsyncRouteHandler): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default asyncHandler;
module.exports = asyncHandler;