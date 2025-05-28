import jwt from 'jsonwebtoken';

/**
 * Middleware to verify Bearer JWT token from Authorization header.
 */
export const verifyAuthToken = (req, res, next) => {
  // Validate middleware parameters
  if (!req || !res || typeof next !== 'function') {
    console.error('❌ verifyAuthToken: Invalid middleware parameters');
    console.error('req:', !!req, 'res:', !!res, 'next type:', typeof next);
    
    if (res && typeof res.status === 'function') {
      return res.status(500).json({
        success: false,
        message: 'Internal server error: middleware misconfiguration'
      });
    }
    
    throw new Error('Auth middleware called incorrectly');
  }

  const authHeader = req.headers?.authorization;

  console.log('🔐 Incoming request - checking auth header...');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('🚫 Missing or malformed Authorization header');
    return res.status(401).json({
      success: false,
      message: 'Authorization header with Bearer token required'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.email) {
      console.warn('⚠️ Token verified but no user email in payload:', decoded);
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload: email missing'
      });
    }

    req.user = decoded;
    console.log(`✅ Authenticated as: ${decoded.email}`);
    next();
    
  } catch (error) {
    console.error('❌ JWT verification failed:', error.message);

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
