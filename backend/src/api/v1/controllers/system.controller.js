/**
 * System Controller
 * System information endpoints (features, volumes, usage)
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class SystemController {
  constructor({ featuresService, volumesService, usageService }) {
    this.featuresService = featuresService;
    this.volumesService = volumesService;
    this.usageService = usageService;
  }

  /**
   * GET /api/v1/features
   * Get enabled features and announcements
   */
  async getFeatures(req, res, next) {
    try {
      const features = await this.featuresService.getFeatures();
      return res.json(features);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/volumes
   * Get list of volumes
   */
  async getVolumes(req, res, next) {
    try {
      const volumes = await this.volumesService.getVolumes();
      return res.json(volumes);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/usage/*
   * Get disk usage for path
   */
  async getUsage(req, res, next) {
    try {
      const relativePath = req.params[0] || '';
      const usage = await this.usageService.getUsage(relativePath);
      return res.json(usage);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SystemController;
