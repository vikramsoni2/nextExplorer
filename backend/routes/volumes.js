const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const { directories, excludedFiles } = require('../config/index');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');
const { getUserVolumes, getById } = require('../services/users');

const router = express.Router();

router.get('/volumes', asyncHandler(async (req, res) => {
  const volumeData = [];
  const currentUserId = req.user?.id;
  const currentUserRoles = req.user?.roles || [];
  const isAdmin = currentUserRoles.includes('admin');

  // Add user's home directory (if user is logged in)
  if (currentUserId) {
    try {
      const user = await getById(currentUserId);
      if (user) {
        const userRow = await require('../services/db').getDb().then(db =>
          db.prepare('SELECT home_directory_path FROM users WHERE id = ?').get(currentUserId)
        );

        if (userRow?.home_directory_path) {
          // Get relative path from volume root
          const relativePath = path.relative(directories.volume, userRow.home_directory_path);
          volumeData.push({
            name: 'My Documents',
            path: relativePath,
            kind: 'home',
          });
        }
      }
    } catch (err) {
      logger.warn({ err, userId: currentUserId }, 'Failed to get user home directory');
    }
  }

  // Add user's assigned volumes
  if (currentUserId) {
    try {
      const userVolumes = await getUserVolumes(currentUserId);
      for (const vol of userVolumes) {
        const relativePath = path.relative(directories.volume, vol.volume_path);
        volumeData.push({
          name: vol.volume_name,
          path: relativePath,
          kind: 'assigned',
        });
      }
    } catch (err) {
      logger.warn({ err, userId: currentUserId }, 'Failed to get user volumes');
    }
  }

  // For admins, also add all volumes (but exclude user home directories)
  if (isAdmin) {
    try {
      const entries = await fs.readdir(directories.volume, { withFileTypes: true });
      const userHomesDir = path.basename(directories.userHomes);

      const allVolumes = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !excludedFiles.includes(name))
        .filter((name) => name !== userHomesDir) // Exclude user_homes directory
        .map((name) => ({
          name,
          path: name,
          kind: 'volume',
        }));

      // Add only volumes that aren't already in volumeData
      const existingPaths = new Set(volumeData.map(v => v.path));
      for (const vol of allVolumes) {
        if (!existingPaths.has(vol.path)) {
          volumeData.push(vol);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read volume directory');
    }
  }

  res.json(volumeData);
}));

module.exports = router;
