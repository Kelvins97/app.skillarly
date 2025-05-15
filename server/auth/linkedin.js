import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Validate environment variables
const validateEnv = () => {
  console.log('LinkedIn Client ID:', process.env.LINKEDIN_CLIENT_ID?.substring(0, 4) + '****');
  console.log('LinkedIn Client Secret:', process.env.LINKEDIN_CLIENT_SECRET?.substring(0, 4) + '****');
  console.log('LinkedIn Callback URL:', process.env.LINKEDIN_CALLBACK_URL);
  
  if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
    throw new Error('LinkedIn OAuth credentials not configured!');
  }
  
  if (!process.env.LINKEDIN_CALLBACK_URL) {
    throw new Error('LinkedIn callback URL not configured!');
  }
  
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured!');
  }
  
  if (!process.env.FRONTEND_URL) {
    throw new Error('FRONTEND_URL not configured!');
  }
};

// Configure LinkedIn strategy
const configureLinkedInStrategy = () => {
  passport.use(new LinkedInStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL,
    scope: ['openid', 'profile', 'w_member_social', 'email'],
    state: true,
    passReqToCallback: true
  }, (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('⏳ LinkedIn Auth Flow Started');
      console.log('🔑 Access Token:', accessToken?.substring(0, 6) + '...');
      console.log('📄 Profile ID:', profile?.id || 'missing');
      
      if (!profile?.id) {
        console.error('❌ Missing Profile ID');
        return done(new Error('invalid_profile'), null);
      }
      
      const user = {
        id: profile.id,
        sub: profile._json?.sub || profile.id,
        name: profile.displayName || 'Anonymous',
        email: profile.emails?.[0]?.value || null,
        profileUrl: profile._json?.vanityName 
          ? `https://linkedin.com/in/${profile._json.vanityName}`
          : null,
        accessToken: accessToken
      };
      
      console.log('👤 Processed User:', JSON.stringify({
        id: user.id,
        name: user.name,
        email: user.email,
        profileUrl: user.profileUrl
      }, null, 2));
      
      return done(null, user);
    } catch (error) {
      console.error('🔥 Critical Error in LinkedIn Strategy:', error.stack);
      return done(error);
    }
  }));
};

// Configure passport serialization
const configurePassport = () => {
  passport.serializeUser((user, done) => {
    console.log('Serializing user:', user.id);
    done(null, user);
  });
  
  passport.deserializeUser((user, done) => {
    console.log('Deserializing user:', user.id);
    done(null, user);
  });
};

// JWT token generation
const generateSecureToken = (user) => {
  console.log('Generating JWT token for user:', user.id);
  return jwt.sign(
    {
      sub: user.sub,
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
    
    // Debug route to check if auth routes are registered
    router.get('/auth-status', (req, res) => {
      res.json({ status: 'Auth routes initialized' });
    });
    
    // LinkedIn authentication initiation
    router.get('/linkedin', (req, res, next) => {
      console.log('Starting LinkedIn authentication flow');
      passport.authenticate('linkedin')(req, res, next);
    });
    
    // LinkedIn callback handler
    router.get('/linkedin/callback', (req, res, next) => {
      console.log('LinkedIn callback received');
      
      passport.authenticate('linkedin', { session: false }, (err, user, info) => {
        console.log('Auth result:', { error: err?.message, hasUser: !!user });
        
        if (err || !user) {
          console.error('Authentication error:', err);
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
    
    // Logout route
    router.get('/logout', (req, res) => {
      req.logout((err) => {
        if (err) {
          console.error('Logout error:', err);
        }
        res.redirect(process.env.FRONTEND_URL);
      });
    });
    
    // Testing routes
    router.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', message: 'Auth service is healthy' });
    });
    
    return router;
  } catch (error) {
    console.error('Authentication initialization failed:', error);
    // Instead of terminating, return a router that reports the error
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
