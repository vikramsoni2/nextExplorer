const express = require('express');

const {
  listTrashItems,
  restoreTrashItems,
  deleteTrashItems,
} = require('../services/trashService');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/trash', async (req, res) => {
  try {
    const items = await listTrashItems();
    res.json({ items });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list trash items');
    res.status(500).json({ error: 'Failed to list trash items.' });
  }
});

router.post('/trash/restore', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'At least one id is required.' });
    }

    const results = await restoreTrashItems(ids);
    res.json({ success: true, items: results });
  } catch (error) {
    logger.error({ err: error }, 'Failed to restore trash items');
    res.status(400).json({ error: error.message || 'Failed to restore trash items.' });
  }
});

router.delete('/trash', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'At least one id is required.' });
    }

    const results = await deleteTrashItems(ids);
    res.json({ success: true, items: results });
  } catch (error) {
    logger.error({ err: error }, 'Failed to permanently delete trash items');
    res.status(400).json({ error: error.message || 'Failed to permanently delete trash items.' });
  }
});

module.exports = router;

