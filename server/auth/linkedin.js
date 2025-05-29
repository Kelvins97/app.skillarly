import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role key for server-side operations
);

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

// Function to insert user in Supabase if not exists
const insertUserIfNotExists = async (userData) => {
  try {
    if (!userData.email) {
      console.log('No email available, skipping database insertion');
      return null;
    }

    console.log('Checking if user exists in Supabase:', userData.email);
    
    // First check if user exists
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', userData.email)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking existing user:', selectError);
      throw selectError;
    }

    if (existingUser) {
      console.log('User already exists with ID:', existingUser.id);
      return existingUser;
    }

    // User doesn't exist, create new record with available data
    const userRecord = {
      email: userData.email,
      name: userData.name || null,
      profilepicture: userData.picture || null
    };

    console.log('Inserting new user:', userRecord);
    
    const { data, error } = await supabase
      .from('users')
      .insert(userRecord)
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    console.log('User inserted successfully:', data.id);
    return data;
  } catch (error) {
    console.error('Error handling user in database:', error);
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
      'FRONTEND_URL',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
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
        linkedinConfigured: !!process.env.LINKEDIN_CLIENT_ID,
        supabaseConfigured: !!process.env.SUPABASE_URL
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
        
        // Debug logging to verify the request being sent
        console.log('Token request details:');
        console.log('- Endpoint: https://www.linkedin.com/oauth/v2/accessToken');
        console.log('- Redirect URI:', process.env.LINKEDIN_CALLBACK_URL);
        console.log('- Client ID:', process.env.LINKEDIN_CLIENT_ID ? '[PRESENT]' : '[MISSING]');
        console.log('- Client Secret:', process.env.LINKEDIN_CLIENT_SECRET ? '[PRESENT]' : '[MISSING]');
        console.log('- Code:', code ? '[PRESENT]' : '[MISSING]');
        
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
            
            // Additional logging to help diagnose issues
            if (tokenResponse.status === 401) {
              console.error('Client authentication failed - please verify:');
              console.error('1. LinkedIn Client ID is correct');
              console.error('2. LinkedIn Client Secret is correct (no extra spaces, encoding issues)');
              console.error('3. Redirect URI exactly matches what is configured in LinkedIn');
            } else if (tokenResponse.status === 400) {
              console.error('Bad request - check these common issues:');
              console.error('1. The authorization code may have expired (they are short-lived)');
              console.error('2. The code might have been used already (can only be used once)');
              console.error('3. Redirect URI in token request must match the one used during authorization');
            }
            
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed&status=${tokenResponse.status}`);
          }
        } catch (error) {
          console.error('Network error during token exchange:', error);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=network_error`);
        }
        
        let tokenData;
        try {
          tokenData = await tokenResponse.json();
          
          // Debug token response
          console.log('Token response received:');
          console.log('- Access token present:', !!tokenData.access_token);
          console.log('- ID token present:', !!tokenData.id_token);
          console.log('- Token type:', tokenData.token_type);
          console.log('- Expires in:', tokenData.expires_in);
          
          if (!tokenData.access_token) {
            console.error('No access token in response');
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
          }
        } catch (error) {
          console.error('Error parsing token response:', error);
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_token_response`);
        }
        
        // Using OpenID Connect instead of LinkedIn's v2 API
        // Get the ID token claims from LinkedIn OpenID
        const idToken = tokenData.id_token;
        
        if (!idToken) {
          console.error('No ID token in response');
          console.log('Falling back to LinkedIn API for profile information');
          
          // Fallback to using the LinkedIn API to get profile information
          try {
            console.log('Fetching profile from LinkedIn API');
            const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/json'
              }
            });
            
            if (!profileResponse.ok) {
              const errorText = await profileResponse.text();
              console.error(`Profile API failed: ${profileResponse.status} ${errorText}`);
              
              // Try a second fallback to the me endpoint with proper version header
              console.log('Trying alternative endpoint...');
              const meResponse = await fetch('https://api.linkedin.com/v2/me', {
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Accept': 'application/json',
                  'LinkedIn-Version': '202305' // Using a specific version header
                }
              });
              
              if (!meResponse.ok) {
                const meErrorText = await meResponse.text();
                console.error(`Me API failed: ${meResponse.status} ${meErrorText}`);
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=profile_fetch_failed`);
              }
              
              const profileData = await meResponse.json();
              console.log('Profile data retrieved via API:', JSON.stringify(profileData).substring(0, 100) + '...');
              
              // Get additional profile data
              const additionalData = await getLinkedInProfileData(tokenData.access_token);
              
              // Create user object from API data
              const user = {
                id: profileData.id,
                name: `${profileData.localizedFirstName || ''} ${profileData.localizedLastName || ''}`.trim() || 'LinkedIn User',
                email: null, // Email might not be available without additional API calls
                accessToken: tokenData.access_token,
                ...additionalData
              };
              
              // Insert/update user in Supabase if email is available
              let dbUser = null;
              if (user.email) {
                try {
                  dbUser = await upsertUser(user);
                  console.log('User saved to database with ID:', dbUser.id);
                } catch (dbError) {
                  console.error('Database error:', dbError);
                  // Continue with authentication even if DB fails
                }
              }
              
              // Generate JWT token
              const token = generateSecureToken({
                ...user,
                dbId: dbUser?.id // Include database ID if available
              });
              
              // Redirect to frontend with token
              return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
            }
            
            const userInfo = await profileResponse.json();
            console.log('UserInfo data:', JSON.stringify(userInfo).substring(0, 100) + '...');
            
            // Create user object from userInfo endpoint
            const user = {
              id: userInfo.sub,
              name: userInfo.name || 'LinkedIn User',
              email: userInfo.email,
              accessToken: tokenData.access_token,
              picture: userInfo.picture
            };
            
            // Insert user in Supabase if not exists
            let dbUser = null;
            if (user.email) {
              try {
                dbUser = await insertUserIfNotExists(user);
                console.log('User handled in database with ID:', dbUser?.id || 'existing');
              } catch (dbError) {
                console.error('Database error:', dbError);
                // Continue with authentication even if DB fails
              }
            }
            
            // Generate JWT token
            const token = generateSecureToken({
              ...user,
              dbId: dbUser?.id // Include database ID if available
            });
            
            // Redirect to frontend with token
            return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
          } catch (apiError) {
            console.error('API fallback error:', apiError);
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=api_fallback_failed`);
          }
        }
        
        // If we have an ID token, decode it
        console.log('ID token received, decoding...');
        
        // Decode the ID token to get user information
        // Note: In production, you should validate the token signature
        const idTokenParts = idToken.split('.');
        let decodedToken;
        
        try {
          // Handle potential padding issues with base64 decoding
          const base64 = idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padding = '='.repeat((4 - base64.length % 4) % 4);
          const decodedString = Buffer.from(base64 + padding, 'base64').toString();
          decodedToken = JSON.parse(decodedString);
          
          console.log('Decoded token:', JSON.stringify(decodedToken).substring(0, 100) + '...');
          console.log('Token fields:', Object.keys(decodedToken).join(', '));
        } catch (error) {
          console.error('Failed to decode ID token:', error);
          console.error('Token parts structure:', {
            header: idTokenParts[0] ? 'present' : 'missing',
            payload: idTokenParts[1] ? 'present' : 'missing',
            signature: idTokenParts[2] ? 'present' : 'missing'
          });
          return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_id_token`);
        }
        
        // Log complete token contents for debugging
        console.log('Full decoded token contents:');
        for (const [key, value] of Object.entries(decodedToken)) {
          console.log(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
        }
        
        // Create user object from OpenID claims
        // LinkedIn ID token structure may vary - we need to be flexible
        const user = {
          id: decodedToken.sub || decodedToken.iss_id || '',
          name: decodedToken.name || 'LinkedIn User',
          email: decodedToken.email || '',
          picture: decodedToken.picture,
          // Store additional fields if available
          givenName: decodedToken.given_name || decodedToken.firstName || '',
          familyName: decodedToken.family_name || decodedToken.lastName || '',
          accessToken: tokenData.access_token
        };
        
        // If user ID is missing or empty, try to get it from alternative sources
        if (!user.id) {
          // If we couldn't get a user ID from the token, try to extract from other fields
          console.log('User ID missing from token claims, checking alternative sources');
          
          // Check for email-based identity
          if (decodedToken.email) {
            user.id = `email:${decodedToken.email}`;
            console.log('Using email as user ID fallback');
          } 
          // Last resort - generate a pseudo-unique ID
          else {
            user.id = `linkedin:${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            console.log('Generated fallback ID');
          }
        }
        
        console.log('Final user object:', JSON.stringify({
          ...user,
          accessToken: user.accessToken ? '[PRESENT]' : '[MISSING]'
        }));
        
        // Insert user in Supabase if not exists
        let dbUser = null;
        if (user.email) {
          try {
            dbUser = await insertUserIfNotExists(user);
            console.log('User handled in database with ID:', dbUser?.id || 'existing');
          } catch (dbError) {
            console.error('Database error:', dbError);
            // Continue with authentication even if DB fails
          }
        } else {
          console.log('No email available, skipping database insertion');
        }
        
        // Generate JWT token
        try {
          const token = generateSecureToken({
            ...user,
            dbId: dbUser?.id // Include database ID if available
          });
          console.log('JWT token generated successfully');
          
          // Redirect to frontend with token
          const encodedToken = encodeURIComponent(token);
          const redirectUrl = `${process.env.FRONTEND_URL}/auth/success?token=${encodedToken}`;
          console.log('Redirecting to:', redirectUrl);
          
          // For debugging purposes, log the token length
          console.log('Token length:', token.length);
          
          // Use a simple 302 redirect which works best across browsers
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
