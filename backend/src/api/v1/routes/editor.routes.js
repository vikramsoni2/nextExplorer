/**
 * Editor Routes
 * Text file editing API routes
 */

const express = require('express');

/**
 * Create editor routes
 */
function createEditorRoutes(editorController, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Get supported extensions
  router.get('/supported-extensions', editorController.getSupportedExtensions.bind(editorController));

  // Read file (GET with wildcard)
  router.get('/*', editorController.readFile.bind(editorController));

  // Write file (PUT with wildcard)
  router.put('/*', editorController.writeFile.bind(editorController));

  return router;
}

module.exports = createEditorRoutes;
