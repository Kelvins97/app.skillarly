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
      profilePicture: user.profilePicture, // Add profile picture to JWT
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

// Function to fetch LinkedIn profile picture
const fetchLinkedInProfilePicture = async (accessToken) => {
  try {
    console.log('Fetching profile picture from LinkedIn API');
    
    // LinkedIn v2 API endpoint for profile pictures
    const profilePictureResponse = await fetch('https://api.linkedin.com/v2/me?projection=(id,profilePicture(displayImage~:playableStreams))', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'LinkedIn-Version': '202305'
      }
    });
    
    if (profilePictureResponse.ok) {
      const pictureData = await profilePictureResponse.json();
      console.log('Profile picture data structure:', JSON.stringify(pictureData, null, 2));
      
      // Extract the profile picture URL from the complex nested structure
      const profilePicture = pictureData.profilePicture;
      if (profilePicture && profilePicture['displayImage~'] && profilePicture['displayImage~'].elements) {
        const elements = profilePicture['displayImage~'].elements;
        
        // Get the largest available image (usually the last one in the array)
        const largestImage = elements[elements.length - 1];
        if (largestImage && largestImage.identifiers && largestImage.identifiers.length > 0) {
          const imageUrl = largestImage.identifiers[0].identifier;
          console.log('Profile picture URL found:', imageUrl);
          return imageUrl;
        }
      }
    } else {
      console.log('Could not fetch profile picture:', profilePictureResponse.status);
    }
  } catch (error) {
    console.error('Error fetching profile picture:', error);
  }
  
  return null;
};

// Function to fetch email address separately (if needed)
const fetchLinkedInEmail = async (accessToken) => {
  try {
    console.log('Fetching email from LinkedIn API');
    
    const emailResponse = await fetch('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'LinkedIn-Version': '202305'
      }
    });
    
    if (emailResponse.ok) {
      const emailData = await emailResponse.json();
      console.log('Email data:', JSON.stringify(emailData, null, 2));
      
      if (emailData.elements && emailData.elements.length > 0) {
        const emailElement = emailData.elements[0];
        if (emailElement['handle~'] && emailElement['handle~'].emailAddress) {
          const email = emailElement['handle~'].emailAddress;
          console.log('Email found:', email);
          return email;
        }
      }
    } else {
      console.log('Could not fetch email:', emailResponse.status);
    }
  } catch (error) {
    console.error('Error fetching email:', error);
  }
  
  return null;
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
      
      // Updated scopes to include profile picture access
      const scopes = 'openid profile email r_basicprofile';
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
        console.log('LinkedIn callback received');
        const { code, state, error, error_description } = req.query;
        
        // Check for OAuth errors first
        if (error) {
          console.error(`LinkedIn OAuth error: ${error} - ${error_description}`);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=${error}&details=${encodeURIComponent(error_description || '')}`);
        }
        
        if (!code) {
          console.error('Missing authorization code');
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
        }
        
        console.log('Authorization code received:', code.substring(0, 5) + '...');
        
        // State validation (if session is available)
        if (req.session?.linkedInState) {
          console.log('Validating state parameter');
          if (req.session.linkedInState !== state) {
            console.error('State mismatch - possible CSRF attack');
            console.error(`Expected: ${req.session.linkedInState}, Received: ${state}`);
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
          }
          console.log('State validation passed');
        } else {
          console.log('No session state available for validation');
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
        let tokenResponse;
        try {
          tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
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
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed&status=${tokenResponse.status}`);
          }
        } catch (error) {
          console.error('Network error during token exchange:', error);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=network_error`);
        }
        
        let tokenData;
        try {
          tokenData = await tokenResponse.json();
          
          if (!tokenData.access_token) {
            console.error('No access token in response');
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
          }
        } catch (error) {
          console.error('Error parsing token response:', error);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_token_response`);
        }
        
        // Get basic profile information
        let user = {};
        
        // Try to get user info from the userinfo endpoint first
        try {
          console.log('Fetching profile from LinkedIn API');
          const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Accept': 'application/json'
            }
          });
          
          if (profileResponse.ok) {
            const userInfo = await profileResponse.json();
            console.log('UserInfo data:', JSON.stringify(userInfo).substring(0, 100) + '...');
            
            user = {
              id: userInfo.sub,
              name: userInfo.name || 'LinkedIn User',
              email: userInfo.email,
              accessToken: tokenData.access_token
            };
          } else {
            // Fallback to the me endpoint
            console.log('UserInfo endpoint failed, trying me endpoint...');
            const meResponse = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)', {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/json',
                'LinkedIn-Version': '202305'
              }
            });
            
            if (!meResponse.ok) {
              throw new Error(`Profile fetch failed: ${meResponse.status}`);
            }
            
            const profileData = await meResponse.json();
            console.log('Profile data retrieved via me endpoint:', JSON.stringify(profileData).substring(0, 100) + '...');
            
            // Try to get email separately
            const email = await fetchLinkedInEmail(tokenData.access_token);
            
            user = {
              id: profileData.id,
              name: `${profileData.localizedFirstName || ''} ${profileData.localizedLastName || ''}`.trim() || 'LinkedIn User',
              email: email,
              accessToken: tokenData.access_token
            };
          }
        } catch (apiError) {
          console.error('Profile fetch error:', apiError);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=profile_fetch_failed`);
        }
        
        // Now fetch the profile picture
        const profilePictureUrl = await fetchLinkedInProfilePicture(tokenData.access_token);
        if (profilePictureUrl) {
          user.profilePicture = profilePictureUrl;
          console.log('Profile picture added to user data');
        } else {
          console.log('No profile picture found or failed to fetch');
        }
        
        // Ensure we have a user ID
        if (!user.id) {
          if (user.email) {
            user.id = `email:${user.email}`;
            console.log('Using email as user ID fallback');
          } else {
            user.id = `linkedin:${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            console.log('Generated fallback ID');
          }
        }
        
        console.log('Final user object:', JSON.stringify({
          ...user,
          accessToken: user.accessToken ? '[PRESENT]' : '[MISSING]',
          profilePicture: user.profilePicture ? user.profilePicture.substring(0, 50) + '...' : '[NONE]'
        }));
        
        // Generate JWT token (now includes profile picture)
        try {
          const token = generateSecureToken(user);
          console.log('JWT token generated successfully');
          
          // Redirect to frontend with token
          const encodedToken = encodeURIComponent(token);
          const redirectUrl = `${process.env.FRONTEND_URL}/auth/success?token=${encodedToken}`;
          console.log('Redirecting to:', redirectUrl);
          
          return res.status(302).redirect(redirectUrl);
        } catch (jwtError) {
          console.error('Error generating JWT:', jwtError);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=jwt_generation_failed`);
        }
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
