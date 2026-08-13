/**
 * Send a successful JSON response
 */
const successResponse = (res, message, data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error JSON response
 */
const errorResponse = (res, message, statusCode = 400, errors = []) => {
  const response = {
    success: false,
    message,
  };
  if (errors && errors.length > 0) {
    response.errors = errors;
  }
  return res.status(statusCode).json(response);
};

module.exports = { successResponse, errorResponse };
