import express from 'express';
import { verifyAuthToken } from './authMiddleware.js';
import jwt from 'jsonwebtoken';
import supabase from './supabase.js';

const router = express.Router();

// Verify token and return user information
router.get('/verify', verifyAuthToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email
    }
  });
});

// For testing in development - manually create a token
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev-token', async (req, res) => {
    const { email, name } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({ 
        success: false,
        message: 'Email and name are required'
      });
    }
    
    try {
      // Create or get user from database
      const { data: user, error } = await supabase
        .from('users')
        .upsert([{ email, name }], { onConflict: 'email' })
        .select()
        .single();
        
      if (error) throw error;
      
      // Generate JWT token
      const token = jwt.sign(
        {
          sub: user.id.toString(),
          id: user.id,
          email: user.email,
          name: user.name,
          exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
        },
        process.env.JWT_SECRET,
        { algorithm: 'HS256' }
      );
      
      res.json({ success: true, token });
    } catch (error) {
      console.error('Error generating dev token:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to generate development token'
      });
    }
  });
}

export default router;