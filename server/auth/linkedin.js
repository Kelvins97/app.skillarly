import express from 'express';
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
      
      // Store state in session if available
      if (req.session) {
        req.session.linkedInState = state;
      }
      
      // Build LinkedIn authorization URL manually
      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('client_id', process.env.LINKEDIN_CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
      authUrl.searchParams.append('state', state);
      authUrl.searchParams.append('scope', 'openid profile email');  // Updated scopes
      
      // Redirect to LinkedIn
      res.redirect(authUrl.toString());
    });
    
    // LinkedIn callback handler with OpenID Connect flow
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
        
        // Exchange authorization code for access token
        const tokenRequestBody = new URLSearchParams();
        tokenRequestBody.append('grant_type', 'authorization_code');
        tokenRequestBody.append('code', code);
        tokenRequestBody.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
        tokenRequestBody.append('client_id', process.env.LINKEDIN_CLIENT_ID);
        tokenRequestBody.append('client_secret', process.env.LINKEDIN_CLIENT_SECRET);
        
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: tokenRequestBody.toString()
        });
        
        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.text();
          console.error(`Token exchange failed: ${tokenResponse.status} ${errorData}`);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed`);
        }
        
        const tokenData = await tokenResponse.json();
        
        if (!tokenData.access_token) {
          console.error('No access token in response');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
        }
        
        // Fetch user info from OpenID Connect userinfo endpoint
        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Accept': 'application/json'
          }
        });
        
        if (!profileResponse.ok) {
          const errorText = await profileResponse.text();
          console.error('Profile fetch failed:', errorText);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=profile_fetch_failed`);
        }
        
        const profileData = await profileResponse.json();
        
        // Construct user object from OpenID userinfo response
        const user = {
          id: profileData.sub,
          name: profileData.name || `${profileData.given_name} ${profileData.family_name}`,
          email: profileData.email,
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

console.log('Token request body:', tokenRequestBody.toString());
console.log('Client ID:', process.env.LINKEDIN_CLIENT_ID);
console.log('Redirect URI:', process.env.LINKEDIN_CALLBACK_URL);

const errorData = await tokenResponse.text();
console.error('Token exchange failed:', errorData);

