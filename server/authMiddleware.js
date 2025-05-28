import jwt from 'jsonwebtoken';

/**
 * Middleware to verify Bearer JWT token from Authorization header.
 */
export const verifyAuthToken = (req, res, next) => {
  // Validate middleware context first
  if (!res || typeof res.status !== 'function' || typeof next !== 'function') {
    const error = new Error('Auth middleware called without proper Express context');
    console.error('❌ Middleware setup error:', error.message);
    throw error; // Fail fast with clear error
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authorization header with Bearer token required'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.email) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload: email missing'
      });
    }

    req.user = decoded;
    next(); // Proceed to next middleware
  } catch (error) {
    let message = 'Authentication failed';
    
    if (error.name === 'TokenExpiredError') {
      message = 'Token expired — please log in again';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid authentication token';
    }

    return res.status(401).json({
      success: false,
      message
    });
  }
};
