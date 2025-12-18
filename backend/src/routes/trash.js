const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { UnauthorizedError, ValidationError } = require('../errors/AppError');
const { listTrashItems, restoreTrashItem } = require('../services/trashService');
const { getContextFromRequest } = require('../services/accessManager');

const router = express.Router();

const requireAuth = (req, _res, next) => {
  if (!req.user?.id) {
    throw new UnauthorizedError('Authentication required');
  }
  return next();
};

router.use('/trash', requireAuth);

/**
 * GET /api/trash
 * List trashed items for the current user.
 */
router.get('/trash', asyncHandler(async (req, res) => {
  const items = (await listTrashItems(req.user.id)).map(({ trashAbsolutePath, ...rest }) => rest);
  res.json({ items });
}));

/**
 * POST /api/trash/restore
 * Restore a trashed item to its original location.
 */
router.post('/trash/restore', asyncHandler(async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !id.trim()) {
    throw new ValidationError('Trash item id is required.');
  }

  const context = getContextFromRequest(req);
  const restored = await restoreTrashItem(id, context);
  res.json({ success: true, restored });
}));

module.exports = router;
