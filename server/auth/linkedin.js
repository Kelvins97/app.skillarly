import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const router = express.Router();

// Validate environment variables
const validateEnv = () => {
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
  
  console.log('LinkedIn Client ID:', process.env.LINKEDIN_CLIENT_ID?.substring(0, 4) + '****');
  console.log('LinkedIn Callback URL:', process.env.LINKEDIN_CALLBACK_URL);
  // Never log even partial secrets in production
};

// Configure LinkedIn strategy
const configureLinkedInStrategy = () => {
  passport.use(new LinkedInStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL,
    scope: ['openid', 'profile', 'email'], // Current LinkedIn scopes
    state: true,
    passReqToCallback: true,
    session: false // Using stateless authentication approach to avoid session issues
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('LinkedIn Auth Flow Started');
      
      // Enhanced profile debugging
      console.log('Profile Details:', {
        id: profile?.id || 'missing',
        displayName: profile?.displayName || 'missing',
        hasEmail: !!profile?.emails?.length,
        emailValue: profile?.emails?.[0]?.value || 'missing'
      });
      
      if (!profile || !profile.id) {
        console.error('Missing profile or profile ID');
        return done(new Error('invalid_profile'), null);
      }
      
      // Build user object from profile
      const user = {
        id: profile.id,
        sub: profile._json?.sub || profile.id,
        name: profile.displayName || `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() || 'Anonymous',
        email: profile.emails?.[0]?.value || null,
        accessToken: accessToken
      };
      
      return done(null, user);
    } catch (error) {
      console.error('Error in LinkedIn Strategy:', error);
      return done(error);
    }
  }));
};

// Passport serialization (needed even for stateless approach)
const configurePassport = () => {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
};

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
    validateEnv();
    configureLinkedInStrategy();
    configurePassport();
    
    // Health check route
    router.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', message: 'Auth service is healthy' });
    });
    
    // LinkedIn authentication initiation - STATELESS APPROACH
    router.get('/linkedin', (req, res, next) => {
      console.log('Starting LinkedIn authentication flow');
      
      passport.authenticate('linkedin', { 
        session: false,
        // Custom state parameter can be added here if needed
        state: Buffer.from(Date.now().toString()).toString('hex')
      })(req, res, next);
    });
    
    // LinkedIn callback handler with FALLBACK MECHANISM
    router.get('/linkedin/callback', (req, res, next) => {
      console.log('LinkedIn callback received');
      console.log('Authorization code present:', !!req.query.code);
      
      passport.authenticate('linkedin', { 
        session: false,
        failureRedirect: null // Prevent automatic redirect on failure
      }, async (err, user, info) => {
        console.log('Auth result:', { 
          error: err?.message, 
          hasUser: !!user,
          info: info || 'No info provided'
        });
        
        // Handle passport authentication errors
        if (err || !user) {
          console.log('Standard authentication failed, attempting manual verification');
          
          // Try manual verification if we have a code
          if (req.query.code) {
            return handleManualVerification(req, res);
          }
          
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(err?.message || 'Authentication failed')}`);
        }
        
        try {
          // Generate JWT token
          const token = generateSecureToken(user);
          
          // Redirect to frontend with token
          console.log('Authentication successful, redirecting to frontend');
          return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
        } catch (tokenError) {
          console.error('Token generation error:', tokenError);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent('Server error')}`);
        }
      })(req, res, next);
    });
    
    // Helper function to handle manual verification with FIXED CLIENT AUTHENTICATION
    const handleManualVerification = async (req, res) => {
      const { code } = req.query;
      
      if (!code) {
        console.error('Missing code parameter');
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
      }
      
      try {
        console.log('Manually exchanging code for token...');
        
        // NEW: Create a proper application/x-www-form-urlencoded body
        const tokenRequestBody = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
          client_id: process.env.LINKEDIN_CLIENT_ID,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET
        });
        
        // Get access token using authorization code
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: tokenRequestBody
        });
        
        // Handle token exchange errors
        if (!tokenResponse.ok) {
          const responseText = await tokenResponse.text();
          console.error(`Token exchange failed: ${tokenResponse.status} ${responseText}`);
          
          // Add more detailed debugging for client authentication errors
          if (tokenResponse.status === 401) {
            console.error('CLIENT AUTHENTICATION ERROR: Please verify your LinkedIn client ID and secret are correct');
            console.error('Also verify that the redirect URI exactly matches what is registered in LinkedIn');
          }
          
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed`);
        }
        
        const tokenData = await tokenResponse.json();
        
        if (!tokenData.access_token) {
          console.error('No access token in response');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
        }
        
        // Get basic profile data
        const profileResponse = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Accept': 'application/json'
          }
        });
        
        if (!profileResponse.ok) {
          console.error('Profile fetch failed:', profileResponse.status);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=profile_fetch_failed`);
        }
        
        const profileData = await profileResponse.json();
        
        // Get email address using the correct v2 API endpoint
        const emailResponse = await fetch('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Accept': 'application/json'
          }
        });
        
        let email = null;
        
        if (emailResponse.ok) {
          const emailData = await emailResponse.json();
          email = emailData.elements?.[0]?.['handle~']?.emailAddress;
        } else {
          console.warn('Could not fetch email');
        }
        
        // Create user object
        const user = {
          id: profileData.id,
          name: `${profileData.localizedFirstName} ${profileData.localizedLastName}`,
          email: email,
          accessToken: tokenData.access_token
        };
        
        // Generate JWT token
        const token = generateSecureToken(user);
        
        // Redirect to frontend with token
        return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
      } catch (error) {
        console.error('Manual verification error:', error);
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent('Manual verification failed')}`);
      }
    };
    
    // Direct manual verification endpoint for debugging
    router.get('/manual-verify', handleManualVerification);
    
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
