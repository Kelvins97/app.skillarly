import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Validate environment variables
const validateEnv = () => {
  console.log('LinkedIn Client ID:', process.env.LINKEDIN_CLIENT_ID?.substring(0, 4) + '****');
  console.log('LinkedIn Client Secret:', process.env.LINKEDIN_CLIENT_SECRET?.substring(0, 4) + '****');

  if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
    throw new Error('LinkedIn OAuth credentials not configured!');
  }
};

// auth/linkedin.js
const configureLinkedInStrategy = () => {
  passport.use(new LinkedInStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL,
    scope: ['openid', 'profile', 'email'],
    state: true,
    passReqToCallback: true
  }, (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('⏳ LinkedIn Auth Flow Started');
      console.log('🔑 Access Token:', accessToken?.substring(0, 6) + '...');
      console.log('🔄 Refresh Token:', refreshToken?.substring(0, 6) + '...');
      console.log('📄 Raw Profile:', JSON.stringify(profile, null, 2));

      // Validate critical profile data
      if (!profile?.id) {
        console.error('❌ Missing Profile ID');
        return done(new Error('invalid_profile'), null);
      }

      const user = {
        id: profile.id,
        sub: profile._json?.sub || 'missing_sub',
        name: profile.displayName || 'Anonymous',
        email: profile.emails?.[0]?.value || null,
        profileUrl: profile._json?.vanityName 
          ? `https://linkedin.com/in/${profile._json.vanityName}`
          : null,
        accessToken: accessToken
      };

      console.log('👤 Processed User:', JSON.stringify(user, null, 2));
      return done(null, user);

    } catch (error) {
      console.error('🔥 Critical Error:', error.stack);
      return done(new Error(`auth_failure: ${error.message}`));
    }
  }));
};


// Configure passport serialization
const configurePassport = () => {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
};

// JWT token generation
const generateSecureToken = (user) => {
  return jwt.sign(
    {
      sub: user.sub,
      name: user.name,
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiration
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

  // Initialize auth routes
export const initializeAuth = () => {
  configureLinkedInStrategy();
  
  // Define routes
  router.get('/linkedin', passport.authenticate('linkedin'));
  router.get('/linkedin/callback',
    passport.authenticate('linkedin', { 
      failureRedirect: '/login-failed',
      successRedirect: process.env.FRONTEND_URL
    })
  ); 

  return router;
};


  } catch (error) {
    console.error('Authentication initialization failed:', error);
    process.exit(1);
  }
};
