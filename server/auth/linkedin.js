import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      
      console.log('Starting LinkedIn OAuth flow');
      console.log('- Using client ID:', process.env.LINKEDIN_CLIENT_ID ? '[PRESENT]' : '[MISSING]');
      console.log('- Callback URL:', process.env.LINKEDIN_CALLBACK_URL);
      
      // Build LinkedIn authorization URL manually with correct OpenID scopes
      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('client_id', process.env.LINKEDIN_CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
      authUrl.searchParams.append('state', state);
      
      // Updated scopes to use OpenID Connect
      const scopes = 'openid profile email';
      authUrl.searchParams.append('scope', scopes);
      console.log('- Requesting scopes:', scopes);
      
      const fullAuthUrl = authUrl.toString();
      console.log('- Full authorization URL:', fullAuthUrl);
      
      // Redirect to LinkedIn
      res.redirect(fullAuthUrl);
    });
    
    // LinkedIn callback handler
      router.get('/linkedin/callback', async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=${error}&details=${encodeURIComponent(error_description || '')}`);
      }
      if (!code) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
      }

      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      });

      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
      }

      const accessToken = tokenData.access_token;

      // Fetch profile data
      const meRes = await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': '202305'
        }
      });

      const me = await meRes.json();
      const vanityName = me.vanityName;
      const fullName = `${me.localizedFirstName || ''} ${me.localizedLastName || ''}`.trim();
      const profileUrl = vanityName ? `https://linkedin.com/in/${vanityName}` : null;

      // Fetch email
      const emailRes = await fetch(
        'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const emailJson = await emailRes.json();
      const email = emailJson.elements?.[0]?.['handle~']?.emailAddress;

      const user = {
        id: me.id,
        name: fullName,
        email,
        profileUrl
      };

      const token = generateSecureToken(user);

      // Upsert user into Supabase
      await supabase
        .from('users')
        .upsert([{
          email: user.email,
          name: user.name,
          profile_url: user.profileUrl,
          linkedin_id: user.id
        }], { onConflict: 'email' });

      // Trigger scrape-profile
      try {
        const scrapeRes = await fetch(`${process.env.BACKEND_URL}/scrape-profile`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ profileUrl: user.profileUrl })
        });

        const scrapeJson = await scrapeRes.json();
        if (!scrapeJson.success) {
          console.warn('⚠️ Scrape failed:', scrapeJson.message);
        } else {
          console.log('✅ Scrape successful');
        }
      } catch (err) {
        console.error('❌ Failed to trigger scrape-profile:', err);
      }

      return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error('LinkedIn callback failed:', err);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_exception`);
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
