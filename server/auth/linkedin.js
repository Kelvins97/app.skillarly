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
      email: user.email || null, // Explicitly handle null email
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

// Helper function to fetch email from LinkedIn API
const fetchLinkedInEmail = async (accessToken) => {
  try {
    console.log('Attempting to fetch email from LinkedIn API');
    const emailResponse = await fetch('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'LinkedIn-Version': '202305'
      }
    });

    if (!emailResponse.ok) {
      console.log(`Email API returned ${emailResponse.status}. This is normal if email permission wasn't granted.`);
      return null;
    }

    const emailData = await emailResponse.json();
    console.log('Email API response structure:', JSON.stringify(emailData, null, 2));

    // Extract email from LinkedIn's response structure
    if (emailData.elements && emailData.elements.length > 0) {
      const emailElement = emailData.elements[0];
      const email = emailElement['handle~']?.emailAddress;
      console.log('Extracted email:', email ? '[FOUND]' : '[NOT FOUND]');
      return email || null;
    }

    return null;
  } catch (error) {
    console.error('Error fetching email from LinkedIn:', error);
    return null;
  }
};

// Helper function to fetch user profile from LinkedIn API
const fetchLinkedInProfile = async (accessToken) => {
  try {
    console.log('Fetching profile from LinkedIn API');
    
    // Try the userinfo endpoint first (OpenID Connect)
    const userinfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (userinfoResponse.ok) {
      const userInfo = await userinfoResponse.json();
      console.log('UserInfo endpoint successful');
      
      // Try to get email separately
      const email = await fetchLinkedInEmail(accessToken);
      
      return {
        id: userInfo.sub,
        name: userInfo.name || 'LinkedIn User',
        email: email || userInfo.email || null,
        givenName: userInfo.given_name || '',
        familyName: userInfo.family_name || ''
      };
    }

    // Fallback to the me endpoint
    console.log('UserInfo failed, trying me endpoint');
    const meResponse = await fetch('https://api.linkedin.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'LinkedIn-Version': '202305'
      }
    });

    if (!meResponse.ok) {
      throw new Error(`Profile API failed: ${meResponse.status}`);
    }

    const profileData = await meResponse.json();
    console.log('Me endpoint successful');

    // Try to get email separately
    const email = await fetchLinkedInEmail(accessToken);

    return {
      id: profileData.id,
      name: `${profileData.localizedFirstName || ''} ${profileData.localizedLastName || ''}`.trim() || 'LinkedIn User',
      email: email,
      givenName: profileData.localizedFirstName || '',
      familyName: profileData.localizedLastName || ''
    };
  } catch (error) {
    console.error('Error fetching LinkedIn profile:', error);
    throw error;
  }
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
      
      // Store state in session if available
      if (req.session) {
        req.session.linkedInState = state;
      }
      
      console.log('Starting LinkedIn OAuth flow');
      console.log('- Using client ID:', process.env.LINKEDIN_CLIENT_ID ? '[PRESENT]' : '[MISSING]');
      console.log('- Callback URL:', process.env.LINKEDIN_CALLBACK_URL);
      
      // Build LinkedIn authorization URL with email permission
      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('client_id', process.env.LINKEDIN_CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
      authUrl.searchParams.append('state', state);
      
      // Updated scopes to explicitly request email
      const scopes = 'openid profile email r_emailaddress';
      authUrl.searchParams.append('scope', scopes);
      console.log('- Requesting scopes:', scopes);
      
      const fullAuthUrl = authUrl.toString();
      console.log('- Full authorization URL:', fullAuthUrl);
      
      res.redirect(fullAuthUrl);
    });
    
    // LinkedIn callback handler
    router.get('/linkedin/callback', async (req, res) => {
      try {
        console.log('LinkedIn callback received');
        const { code, state, error, error_description } = req.query;
        
        // Check for OAuth errors
        if (error) {
          console.error(`LinkedIn OAuth error: ${error} - ${error_description}`);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=${error}&details=${encodeURIComponent(error_description || '')}`);
        }
        
        if (!code) {
          console.error('Missing authorization code');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
        }
        
        console.log('Authorization code received');
        
        // State validation
        if (req.session?.linkedInState) {
          if (req.session.linkedInState !== state) {
            console.error('State mismatch - possible CSRF attack');
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
          }
          console.log('State validation passed');
        }
        
        console.log('Exchanging authorization code for access token');
        
        // Exchange code for token
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
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed&status=${tokenResponse.status}`);
        }
        
        const tokenData = await tokenResponse.json();
        console.log('Token response received');
        
        if (!tokenData.access_token) {
          console.error('No access token in response');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
        }
        
        // Try to decode ID token first (if available)
        let user = null;
        
        if (tokenData.id_token) {
          console.log('ID token received, attempting to decode');
          try {
            const idTokenParts = tokenData.id_token.split('.');
            const base64 = idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padding = '='.repeat((4 - base64.length % 4) % 4);
            const decodedString = Buffer.from(base64 + padding, 'base64').toString();
            const decodedToken = JSON.parse(decodedString);
            
            console.log('ID token decoded successfully');
            
            // Try to get email separately if not in token
            let email = decodedToken.email || null;
            if (!email) {
              email = await fetchLinkedInEmail(tokenData.access_token);
            }
            
            user = {
              id: decodedToken.sub || `linkedin-${Date.now()}`,
              name: decodedToken.name || 'LinkedIn User',
              email: email,
              givenName: decodedToken.given_name || '',
              familyName: decodedToken.family_name || '',
              accessToken: tokenData.access_token
            };
          } catch (idTokenError) {
            console.error('Failed to decode ID token:', idTokenError);
          }
        }
        
        // Fallback to API if ID token processing failed
        if (!user) {
          console.log('Falling back to LinkedIn API for profile');
          try {
            const profileData = await fetchLinkedInProfile(tokenData.access_token);
            user = {
              ...profileData,
              accessToken: tokenData.access_token
            };
          } catch (apiError) {
            console.error('Profile API fallback failed:', apiError);
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=profile_fetch_failed`);
          }
        }
        
        // Ensure user has required fields
        if (!user.id) {
          user.id = `linkedin-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        }
        
        console.log('Final user object:', {
          id: user.id,
          name: user.name,
          email: user.email || '[NO EMAIL]',
          hasAccessToken: !!user.accessToken
        });
        
        // Generate JWT token
        const token = generateSecureToken(user);
        console.log('JWT token generated successfully');
        
        // Redirect to frontend with token
        const encodedToken = encodeURIComponent(token);
        const redirectUrl = `${process.env.FRONTEND_URL}/auth/success?token=${encodedToken}`;
        
        return res.status(302).redirect(redirectUrl);
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
