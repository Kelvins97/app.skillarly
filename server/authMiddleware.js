// authMiddleware.js - JWT verification middleware

import jwt from 'jsonwebtoken';

export const verifyAuthToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      message: 'Authorization header with Bearer token required' 
    });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    const message = error.name === 'TokenExpiredError' 
      ? 'Token expired - please reauthenticate' 
      : 'Invalid authentication token';
    res.status(401).json({ success: false, message });
  }
};