/**
 * Response Helper
 * Standardizes API response formats
 */

/**
 * Success Response
 */
class SuccessResponse {
  constructor(data = null, message = null) {
    this.success = true;
    if (data !== null) {
      this.data = data;
    }
    if (message) {
      this.message = message;
    }
  }
}

/**
 * Paginated Response
 */
class PaginatedResponse {
  constructor(data, pagination) {
    this.success = true;
    this.data = data;
    this.pagination = {
      page: pagination.page || 1,
      limit: pagination.limit || 20,
      total: pagination.total || 0,
      totalPages: Math.ceil((pagination.total || 0) / (pagination.limit || 20))
    };
  }
}

/**
 * Created Response
 */
class CreatedResponse {
  constructor(data, message = 'Resource created successfully') {
    this.success = true;
    this.data = data;
    this.message = message;
  }
}

/**
 * No Content Response Helper
 */
function sendNoContent(res) {
  return res.status(204).send();
}

/**
 * Send Success Response
 */
function sendSuccess(res, data = null, statusCode = 200, message = null) {
  return res.status(statusCode).json(new SuccessResponse(data, message));
}

/**
 * Send Created Response
 */
function sendCreated(res, data, message = 'Resource created successfully') {
  return res.status(201).json(new CreatedResponse(data, message));
}

/**
 * Send Paginated Response
 */
function sendPaginated(res, data, pagination) {
  return res.status(200).json(new PaginatedResponse(data, pagination));
}

/**
 * Send Error Response
 */
function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const response = error.toJSON ? error.toJSON() : {
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An error occurred',
      statusCode
    }
  };
  return res.status(statusCode).json(response);
}

module.exports = {
  SuccessResponse,
  PaginatedResponse,
  CreatedResponse,
  sendNoContent,
  sendSuccess,
  sendCreated,
  sendPaginated,
  sendError
};
