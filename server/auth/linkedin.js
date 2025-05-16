import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const router = express.Router();

// JWT token generation
const generateSecureToken = (user) => {
  return jwt.sign(
    {
      sub: user.sub || user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

// Initialize auth routes
export const initializeAuth = () => {
  try {
    // Validate required environment variables
    const requiredVars = [
      'LINKEDIN_CLIENT_ID',
      'LINKEDIN_CLIENT_SECRET',
      'LINKEDIN_CALLBACK_URL',
      'JWT_SECRET',
      'FRONTEND_URL'
    ];
    
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    // Basic passport configuration
    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((user, done) => done(null, user));
    
    // Health check route
    router.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'ok', 
        message: 'Auth service is healthy',
        linkedinConfigured: !!process.env.LINKEDIN_CLIENT_ID
      });
    });
    
    // LinkedIn auth initiation
    router.get('/linkedin', (req, res) => {
      // Generate random state for CSRF protection
      const state = Math.random().toString(36).substring(2, 15);
      
      // Store state in session if available (fallback to stateless if needed)
      if (req.session) {
        req.session.linkedInState = state;
      }
      
      // Build LinkedIn authorization URL manually with correct OpenID scopes
      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('client_id', process.env.LINKEDIN_CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
      authUrl.searchParams.append('state', state);
      // Updated scopes to use OpenID Connect
      authUrl.searchParams.append('scope', 'openid profile email');
      
      // Redirect to LinkedIn
      res.redirect(authUrl.toString());
    });
    
    // LinkedIn callback handler
    router.get('/linkedin/callback', async (req, res) => {
      try {
        const { code, state } = req.query;
        
        if (!code) {
          console.error('Missing authorization code');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
        }
        
        // State validation (if session is available)
        if (req.session?.linkedInState && req.session.linkedInState !== state) {
          console.error('State mismatch - possible CSRF attack');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
        }
        
        console.log('Exchanging authorization code for access token');
        
        // Manually exchange code for token
        const tokenRequestBody = new URLSearchParams();
        tokenRequestBody.append('grant_type', 'authorization_code');
        tokenRequestBody.append('code', code);
        tokenRequestBody.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
        tokenRequestBody.append('client_id', process.env.LINKEDIN_CLIENT_ID);
        tokenRequestBody.append('client_secret', process.env.LINKEDIN_CLIENT_SECRET);
        
        // Make request to LinkedIn token endpoint
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: tokenRequestBody.toString()
        });
        
        // Handle token exchange errors
        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.text();
          console.error(`Token exchange failed: ${tokenResponse.status} ${errorData}`);
          
          // Additional logging to help diagnose issues
          if (tokenResponse.status === 401) {
            console.error('Client authentication failed - please verify:');
            console.error('1. LinkedIn Client ID is correct');
            console.error('2. LinkedIn Client Secret is correct (no extra spaces, encoding issues)');
            console.error('3. Redirect URI exactly matches what is configured in LinkedIn');
          }
          
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed`);
        }
        
        const tokenData = await tokenResponse.json();
        
        if (!tokenData.access_token) {
          console.error('No access token in response');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
        }
        
        // Using OpenID Connect instead of LinkedIn's v2 API
        // Get the ID token claims from LinkedIn OpenID
        const idToken = tokenData.id_token;
        
        if (!idToken) {
          console.error('No ID token in response - OpenID Connect flow failed');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_id_token`);
        }
        
        // Decode the ID token to get user information
        // Note: In production, you should validate the token signature
        const idTokenParts = idToken.split('.');
        let decodedToken;
        
        try {
          decodedToken = JSON.parse(Buffer.from(idTokenParts[1], 'base64').toString());
        } catch (error) {
          console.error('Failed to decode ID token:', error);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_id_token`);
        }
        
        // Create user object from OpenID claims
        const user = {
          id: decodedToken.sub,
          name: decodedToken.name || 'LinkedIn User',
          email: decodedToken.email,
          // Store additional fields if needed
          givenName: decodedToken.given_name,
          familyName: decodedToken.family_name,
          accessToken: tokenData.access_token
        };
        
        // Generate JWT token
        const token = generateSecureToken(user);
        
        // Redirect to frontend with token
        return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
      } catch (error) {
        console.error('LinkedIn callback error:', error);
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
      }
    });
    
    return router;
  } catch (error) {
    console.error('Authentication initialization failed:', error);
    
    const errorRouter = express.Router();
    errorRouter.use((req, res) => {
      res.status(500).json({ 
        error: 'Auth initialization failed', 
        message: error.message 
      });
    });
    return errorRouter;
  }
};
