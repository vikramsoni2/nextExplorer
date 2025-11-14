/**
 * Editor Controller
 * Text file editing endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class EditorController {
  constructor({ editorService }) {
    this.editorService = editorService;
  }

  /**
   * GET /api/v1/editor/*
   * Read file content
   */
  async readFile(req, res, next) {
    try {
      const relativePath = req.params[0] || '';

      const result = await this.editorService.readFile(relativePath);

      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/editor/*
   * Write file content
   */
  async writeFile(req, res, next) {
    try {
      const relativePath = req.params[0] || '';
      const { content } = req.body;

      const result = await this.editorService.writeFile(relativePath, content);

      return sendSuccess(res, result, 'File saved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/editor/supported-extensions
   * Get supported file extensions
   */
  async getSupportedExtensions(req, res, next) {
    try {
      const extensions = this.editorService.getSupportedExtensions();

      return sendSuccess(res, { extensions, count: extensions.length });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = EditorController;
