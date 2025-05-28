import jwt from 'jsonwebtoken';

/**
 * Middleware to verify Bearer JWT token from Authorization header.
 */
export const verifyAuthToken = (req, res, next) => {
  console.log('🔍 === AUTH MIDDLEWARE CALLED ===');
  console.log('Arguments received:', arguments.length);
  console.log('req exists:', !!req, 'type:', typeof req);
  console.log('res exists:', !!res, 'type:', typeof res, 'has status method:', typeof res?.status);
  console.log('next exists:', !!next, 'type:', typeof next);
  
  // Check if we have the basic Express objects
  if (!req || !res) {
    console.error('❌ Missing req or res objects');
    throw new Error('Auth middleware: missing req or res');
  }
  
  if (typeof next !== 'function') {
    console.error('❌ next is not a function, received:', next);
    console.error('This suggests the middleware chain is broken');
    // Log the call stack to see where this is coming from
    console.trace('Call stack:');
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error: middleware chain broken'
    });
  }

  const authHeader = req.headers?.authorization;

  console.log('🔐 Incoming request - checking auth header...');
  console.log('Auth header exists:', !!authHeader);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('🚫 Missing or malformed Authorization header');
    return res.status(401).json({
      success: false,
      message: 'Authorization header with Bearer token required'
    });
  }

  const token = authHeader.split(' ')[1];
  console.log('🔑 Token extracted, length:', token?.length);

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
    console.log('🔄 Calling next() to continue middleware chain...');
    
    // Make sure next is still a function before calling
    if (typeof next === 'function') {
      next();
    } else {
      console.error('❌ next became non-function between checks!');
      throw new Error('next function was corrupted');
    }
    
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
