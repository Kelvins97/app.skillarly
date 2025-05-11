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
      // Debug: Log raw profile data
      console.log('Raw LinkedIn Profile:', JSON.stringify(profile, null, 2));
      console.log('Access Token:', accessToken.substring(0, 6) + '...');
      console.log('Refresh Token:', refreshToken?.substring(0, 6) + '...');

      // Validate critical profile data
      if (!profile?.id) {
        console.error('Invalid profile structure - missing ID');
        return done(new Error('Invalid LinkedIn profile data received'));
      }

      // Construct user object with fallbacks
      const user = {
        id: profile.id,
        sub: profile._json?.sub || profile.id,
        name: profile.displayName || 'Unknown User',
        email: profile.emails?.[0]?.value || null,
        profileUrl: profile._json?.vanityName 
          ? `https://linkedin.com/in/${profile._json.vanityName}`
          : profile._json?.profileUrl || null,
        accessToken: accessToken
      };

      // Debug: Verify email existence
      if (!user.email) {
        console.warn('No email found in profile. Scopes:', profile._json?.scope);
      }

      console.log('Processed User:', JSON.stringify(user, null, 2));
      return done(null, user);

    } catch (error) {
      console.error('LinkedIn Auth Error:', error);
      return done(new Error(`Authentication failed: ${error.message}`));
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

// Initialize authentication module
export const initializeAuth = () => {
  try {
    validateEnv();
    configureLinkedInStrategy();
    configurePassport();
    
    // LinkedIn OAuth routes
    router.get('/linkedin', passport.authenticate('linkedin', {
      session: false // Disable session for JWT
    }));

    router.get('/linkedin/callback', 
      passport.authenticate('linkedin', {
        session: false,
        failureRedirect: '/login-failed'
      }),
      (req, res) => {
        try {
          const token = generateSecureToken(req.user);
          res.redirect(
            `${process.env.FRONTEND_URL}/dashboard?` +
            `token=${encodeURIComponent(token)}` +
            `&profile=${encodeURIComponent(req.user.profileUrl)}`
          );
        } catch (error) {
          res.redirect('/login-failed?error=token_generation_failed');
        }
      }
    );

    return router;
  } catch (error) {
    console.error('Authentication initialization failed:', error);
    process.exit(1);
  }
};
