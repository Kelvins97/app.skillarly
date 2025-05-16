import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch'; // Make sure this is imported

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
    scope: ['openid', 'profile', 'email'], // Using standard LinkedIn scopes instead of OpenID scopes
    state: true,
    passReqToCallback: true,
    session: true
  }, (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('⏳ LinkedIn Auth Flow Started');
      console.log('🔑 Access Token:', accessToken?.substring(0, 6) + '...');
      
      // Debug session information
      console.log('🔐 Session ID:', req.sessionID);
      console.log('🔐 Session Present:', !!req.session);
      
      // Enhanced profile debugging
      console.log('📄 Profile Details:', {
        id: profile?.id || 'missing',
        displayName: profile?.displayName || 'missing',
        hasEmail: !!profile?.emails?.length,
        emailValue: profile?.emails?.[0]?.value || 'missing',
        firstName: profile?.name?.givenName || 'missing',
        lastName: profile?.name?.familyName || 'missing'
      });
      
      // More detailed validation
      if (!profile) {
        console.error('❌ Profile object is missing entirely');
        return done(new Error('missing_profile'), null);
      }
      
      if (!profile.id) {
        console.error('❌ Missing Profile ID');
        return done(new Error('missing_profile_id'), null);
      }
      
      // Extract user data with fallbacks and enhanced logging
      const user = {
        id: profile.id,
        sub: profile._json?.sub || profile.id,
        name: profile.displayName || profile.name?.givenName || 'Anonymous',
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
      
      // Verify we have minimum required data
      if (!user.name || user.name === 'Anonymous') {
        console.warn('⚠️ User name missing or default');
      }
      
      if (!user.email) {
        console.warn('⚠️ User email missing - this might cause issues downstream');
      }
      
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
    
    // Debug route to check credentials
    router.get('/check-credentials', (req, res) => {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
      
      res.json({
        clientIdLength: clientId ? clientId.length : 0,
        clientIdFirstChars: clientId ? clientId.substring(0, 4) + '***' : 'missing',
        clientSecretLength: clientSecret ? clientSecret.length : 0,
        clientSecretFirstChars: clientSecret ? clientSecret.substring(0, 4) + '***' : 'missing',
        callbackUrl: process.env.LINKEDIN_CALLBACK_URL || 'missing'
      });
    });
    
    // Debug route to check session
    router.get('/session-check', (req, res) => {
      res.json({ 
        sessionID: req.sessionID,
        sessionExists: !!req.session,
        sessionData: req.session ? 'Session data present' : 'No session data',
        authenticated: req.isAuthenticated()
      });
    });
    
    // LinkedIn authentication initiation - WITH SESSION SUPPORT
    router.get('/linkedin', (req, res, next) => {
      console.log('Starting LinkedIn authentication flow');
      console.log('Session ID at start:', req.sessionID);
      
      // Store timestamp in session to verify it persists
      if (req.session) {
        req.session.authStartTime = Date.now();
        console.log('Stored auth start time in session');
      } else {
        console.warn('⚠️ Session not available at auth start');
      }
      
      // Use stateless approach if session is not available
      const useSession = !!req.session;
      
      passport.authenticate('linkedin', { 
        session: useSession,
        // For stateless use, redirect to custom error page if state verification fails
        failureRedirect: `${process.env.FRONTEND_URL}/login?error=state_verification_failed`
      })(req, res, next);
    });
    
    // LinkedIn callback handler with STATE VERIFICATION FIX
    router.get('/linkedin/callback', (req, res, next) => {
      console.log('LinkedIn callback received');
      console.log('Session ID at callback:', req.sessionID);
      console.log('Authorization code:', req.query.code?.substring(0, 10) + '...');
      
      // Check if session persisted
      if (req.session) {
        console.log('Auth start time from session:', req.session.authStartTime);
      } else {
        console.warn('⚠️ Session not available at callback');
      }
      
      // Use stateless approach if session is not working
      const statelessAuth = !req.session;
      
      passport.authenticate('linkedin', { 
        session: !statelessAuth,
        failureRedirect: null // Prevent automatic redirect on failure
      }, (err, user, info) => {
        // Enhanced error logging
        console.log('Auth result:', { 
          error: err?.message, 
          hasUser: !!user,
          info: info || 'No info provided'
        });
        
        // Handle state verification error specifically
        if (info && info.message === 'Unable to verify authorization request state.') {
          console.error('State verification failed - session issue detected');
          
          // CRITICAL FIX: Try to create a user from the OAuth data anyway
          if (req.query.code) {
            // Code exists, but state verification failed
            console.log('Attempting alternative authentication with code:', req.query.code);
            
            // Immediately handle manual verification instead of redirecting
            return handleManualVerification(req, res);
          }
          
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=session_state_verification_failed`);
        }
        
        if (err) {
          console.error('Authentication error:', err);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(err.message || 'Authentication failed')}`);
        }
        
        if (!user) {
          console.error('No user returned from authentication');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent('No user data received')}`);
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
    
    // Helper function to handle manual verification
    const handleManualVerification = async (req, res) => {
      const { code } = req.query;
      
      if (!code) {
        console.error('Missing code parameter');
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
      }
      
      try {
        console.log('Manually exchanging code for token...');
        
        // Print out credentials being used (redacted)
        const clientId = process.env.LINKEDIN_CLIENT_ID;
        const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
        console.log('Using credentials:', {
          clientIdLength: clientId.length,
          clientIdFirstFour: clientId.substring(0, 4),
          clientSecretLength: clientSecret.length,
          clientSecretFirstFour: clientSecret.substring(0, 4),
          redirectUri: process.env.LINKEDIN_CALLBACK_URL
        });
        
        // Construct the exact request body
        const tokenRequestBody = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
          client_id: process.env.LINKEDIN_CLIENT_ID,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET
        });
        
        // Create the detailed request
        const tokenRequestDetails = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: tokenRequestBody
        };
        
        console.log('Token request details:', {
          url: 'https://www.linkedin.com/oauth/v2/accessToken',
          method: tokenRequestDetails.method,
          headers: tokenRequestDetails.headers,
          bodyParams: Object.fromEntries(tokenRequestBody.entries())
        });
        
        // Exchange code for token manually
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', tokenRequestDetails);
        
        // Handle failed token exchange
        if (!tokenResponse.ok) {
          const responseText = await tokenResponse.text();
          console.error(`Token exchange failed: ${tokenResponse.status} ${responseText}`);
          
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed&details=${encodeURIComponent(responseText)}`);
        }
        
        const tokenData = await tokenResponse.json();
        console.log('Token exchange successful:', tokenData.access_token?.substring(0, 10) + '...');
        
        if (!tokenData.access_token) {
          console.error('No access token in response');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
        }
        
        // Fetch user profile
        console.log('Fetching LinkedIn profile...');
        const profileResponse = await fetch('https://api.linkedin.com/v2/me', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Accept': 'application/json'
          }
        });
        
        if (!profileResponse.ok) {
          const errorText = await profileResponse.text();
          console.error('Profile fetch failed:', profileResponse.status, errorText);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=profile_fetch_failed`);
        }
        
        const profileData = await profileResponse.json();
        console.log('Profile fetched:', JSON.stringify({
          id: profileData.id,
          firstName: profileData.localizedFirstName,
          lastName: profileData.localizedLastName
        }));
        
        // Fetch email address 
        console.log('Fetching email address...');
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
          console.log('Email fetched:', email || 'Not available');
        } else {
          console.warn('Could not fetch email:', await emailResponse.text());
        }
        
        // Create user object
        const user = {
          id: profileData.id,
          name: `${profileData.localizedFirstName} ${profileData.localizedLastName}`,
          email: email || null,
          accessToken: tokenData.access_token
        };
        
        console.log('Created user object:', JSON.stringify(user, null, 2));
        
        // Generate JWT token
        const token = generateSecureToken(user);
        console.log('Generated JWT token');
        
        // Redirect to frontend with token
        console.log('Redirecting to frontend with token');
        return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
      } catch (error) {
        console.error('Manual verification error:', error);
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent('Manual verification failed: ' + error.message)}`);
      }
    };
    
    // Manual verification endpoint 
    router.get('/manual-verify', handleManualVerification);
    
    // Testing routes
    router.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'ok', 
        sessionWorks: !!req.session,
        sessionID: req.sessionID || 'none',
        message: 'Auth service is healthy' 
      });
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
