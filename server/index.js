import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import stripePackage from 'stripe';
import supabase from './supabase.js';
import { adminSupabase } from './supabase.js';
import scraper from './scraper.js';
import { sendEmail } from './email.js';
import OpenAI from 'openai';
import pg from 'pg';
import Stripe from 'stripe';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';
import session from 'express-session';
import passport from 'passport';
import { initializeAuth } from './auth/linkedin.js';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import { verifyAuthToken } from './authMiddleware.js';
import authRoutes from './authRoutes.js';
import devSeedRoute from './dev-seed.js';

// 1. Environment Configuration
dotenv.config();

// 2. Initialize Core Services
const app = express();
const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redisClient = createClient({ url: process.env.REDIS_URL });

// 3. Enhanced CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://skillarly-app.vercel.app',
      'https://skillarly.com',
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// 4. Middleware Setup
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply CORS before any routes
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// 5. Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  store: new RedisStore({ client: redisClient }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : undefined
  }
}));

// 6. Authentication Setup
app.use(passport.initialize());
app.use(passport.session());

// 7. Redis Connection
(async () => {
  try {
    redisClient.on('error', (err) => {
      console.error('❌ Redis Error:', err);
    });
    
    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });
    
    await redisClient.connect();
    console.log("✅ Redis connected");
    app.emit('redis-connected');
  } catch (error) {
    console.error("❌ Redis connection failed:", error);
    console.log("⚠️ Continuing without Redis - sessions will not persist");
    app.emit('redis-connected');
  }
})();

// 8. Routes Configuration

// Public Routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'success',
    message: '✅ Skillarly backend is live.',
    timestamp: new Date().toISOString()
  });
});

// Auth Routes - Use LinkedIn OAuth and custom auth routes
app.use('/auth', initializeAuth());
app.use('/auth', authRoutes);

// Login failed route
app.get('/login-failed', (req, res) => {
  const error = req.query.error || 'unknown_error';
  console.log(`Login Failed: ${error}`);
  
  if (req.query.details) {
    console.error('Auth failure details:', req.query.details);
  }
  
  res.redirect(`${process.env.FRONTEND_URL}/login-error?from=linkedin&error=${encodeURIComponent(error)}`);
});

// Debugging endpoint for auth status
app.get('/auth-status', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.user ? {
      id: req.user.id,
      name: req.user.name,
    } : null,
    sessionActive: !!req.session,
    passport: !!req.session?.passport
  });
});

// Redirect LinkedIn profile visits
app.get('/go', (req, res) => {
  const ref = req.get('Referrer') || '';
  const baseUrl = process.env.FRONTEND_URL;
  
  if (ref.includes('linkedin.com/in/')) {
    return res.redirect(
      `${baseUrl}/?profile=${encodeURIComponent(ref)}`
    );
  }
  
  return res.redirect(baseUrl);
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  const sessionActive = !!req.session;
  const redisConnected = redisClient.isReady;
  
  res.status(200).json({ 
    status: 'ok', 
    message: 'Service is healthy',
    redis: redisConnected ? 'connected' : 'disconnected',
    session: sessionActive ? 'active' : 'inactive',
    timestamp: new Date().toISOString()
  });
});

app.get('/debug-user-check', verifyAuthToken, async (req, res) => {
  const email = req.user?.email;

  console.log('🧠 JWT Claims:', req.user);
  console.log('📧 Checking email:', email);

  const { data, error } = await adminSupabase
    .from('users')
    .select('*')
    .eq('email', email);

  if (error) {
    console.error('❌ Supabase error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({ 
    success: true, 
    matchedUsers: data.length, 
    email, 
    data 
  });
});

//Dev-seed - manual inputs
app.use('/', devSeedRoute);

//Test adminSupabase
app.get('/debug-users', async (req, res) => {
  const { data, error } = await adminSupabase.from('users').select('*').limit(5);

  if (error) {
    console.error('❌ adminSupabase select failed:', error.message);
    return res.status(500).json({ error: 'admin_select_failed', message: error.message });
  }

  res.json({ users: data });
});

// Test route to debug Supabase user creation
app.post('/test-supabase', verifyAuthToken, async (req, res) => {
  try {
    const email = req.user.email;
    
    console.log('🔍 Testing Supabase connection for email:', email);
    
    // 1. Test Supabase connection
    console.log('Step 1: Testing Supabase connection');
    const { data: healthData, error: healthError } = await adminSupabase.from('health_check').select('*');
    
    if (healthError) {
      console.error('❌ Supabase connection error:', healthError);
      return res.status(500).json({ 
        success: false, 
        error: 'supabase_connection_error',
        message: healthError.message 
      });
    }
    
    console.log('✅ Supabase connection successful');
    
    // 2. Check if user exists
    console.log('Step 2: Checking if user exists');
    const { data: existingUsers, error: findError } = await adminSupabase
      .from('users')
      .select('*')
      .eq('email', email);
      
    if (findError) {
      console.error('❌ Error checking for existing user:', findError);
      return res.status(500).json({ 
        success: false, 
        error: 'user_check_error',
        message: findError.message 
      });
    }
    
    console.log('Existing users found:', existingUsers ? existingUsers.length : 0);
    
    // 3. Create user with raw SQL (bypass potential RLS issues)
    console.log('Step 3: Creating user with raw SQL');
    const { data: sqlResult, error: sqlError } = await supabase.rpc(
      'create_user_bypass_rls',
      { user_email: email }
    );
    
    if (sqlError) {
      console.error('❌ SQL user creation error:', sqlError);
    } else {
      console.log('✅ SQL user creation result:', sqlResult);
    }
    
    // 4. Now try the standard upsert
    console.log('Step 4: Upserting user with standard method');
    const { data: upsertResult, error: upsertError } = await adminSupabase
      .from('users')
      .upsert([{ email: email }], { 
        onConflict: 'email',
        returning: 'representation' 
      })
      .select('*');
      
    if (upsertError) {
      console.error('❌ Standard user upsert error:', upsertError);
    } else {
      console.log('✅ Standard user upsert result:', upsertResult);
    }
    
    // 5. Auth API direct check (if using auth)
    console.log('Step 5: Checking Supabase auth');
    let authUser = null;
    let authError = null;
    
    try {
      const { data, error } = await supabase.auth.admin.getUserByEmail(email);
      authUser = data;
      authError = error;
    } catch (e) {
      console.log('Auth admin API not available or error:', e);
    }
    
    // Return all test results
    return res.json({
      success: true,
      email: email,
      connection: { success: !healthError },
      existing_user: {
        found: existingUsers && existingUsers.length > 0,
        count: existingUsers ? existingUsers.length : 0,
        data: existingUsers?.[0] ? { id: existingUsers[0].id, email: existingUsers[0].email } : null
      },
      sql_creation: {
        success: !sqlError,
        error: sqlError ? sqlError.message : null,
        result: sqlResult
      },
      upsert: {
        success: !upsertError,
        error: upsertError ? upsertError.message : null,
        result: upsertResult ? { 
          count: upsertResult.length,
          first: upsertResult[0] ? { id: upsertResult[0].id, email: upsertResult[0].email } : null 
        } : null
      },
      auth: {
        success: !authError,
        error: authError ? authError.message : null,
        user: authUser ? { id: authUser.id, email: authUser.email } : null
      }
    });
  } catch (error) {
    console.error('❌ Test route error:', error);
    return res.status(500).json({
      success: false,
      error: 'test_failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Protected Routes (using JWT token)
// user-info using adminSupabase only
app.get('/user-info', verifyAuthToken, async (req, res) => {
  console.log('➡️  [GET] /user-info hit');

  try {
    const email = req.user?.email;

    if (!email) {
      console.warn('🚫 Missing email in token');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    console.log('🔍 Looking up user:', email);

    // Fetch user from adminSupabase
    const { data: users, error: fetchError } = await adminSupabase
      .from('users')
      .select('id, email, name, email_notifications, plan, profilepicture, monthly_scrapes')
      .eq('email', email)
      .limit(1);

    if (fetchError) {
      console.error('❌ Supabase fetch error:', fetchError.message);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const userData = users?.[0];

    if (!userData) {
      console.warn('❌ No user found in Supabase for:', email);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ Supabase user:', {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      plan: userData.plan
    });

    const plan = userData.plan || 'basic';
    const monthly_scrapes = userData.monthly_scrapes || 0;

    console.log('📊 Monthly scrapes:', monthly_scrapes);

    // Send response
    res.json({
      success: true,
      id: userData.id,
      email: userData.email,
      name: userData.name,
      plan,
      monthly_scrapes,
      email_notifications: userData.email_notifications !== false,
      profilepicture: userData.profilepicture || null
    });

  } catch (error) {
    console.error('🔥 Unhandled error in /user-info:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});


//user-data ✅ user-data using adminSupabase to bypass RLS
app.get('/user-data', verifyAuthToken, async (req, res) => {
  try {
    const email = req.user?.email;

    if (!email) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized – missing email in token'
      });
    }

    console.log('➡️  [GET] /user-data for:', email);

    // Fetch user data from Supabase (admin client bypasses RLS)
    const { data: users, error: fetchError } = await adminSupabase
      .from('users')
      .select('name, skills, certifications, headline, profilepicture')
      .eq('email', email)
      .limit(1);

    if (fetchError) {
      console.error('❌ Supabase fetch error:', fetchError.message);
      return res.status(500).json({
        success: false,
        message: 'Database error fetching user data'
      });
    }

    const userData = users?.[0];

    if (!userData) {
      console.warn('❌ No user data found for:', email);
      return res.status(404).json({
        success: false,
        message: 'User data not found'
      });
    }

    console.log('✅ Found user data:', {
      name: userData.name,
      skills: userData.skills?.length || 0,
      certifications: userData.certifications?.length || 0
    });

    // Static recommendations (for now)
    const recommendations = [
      'Consider learning GraphQL for API development',
      'Your profile would benefit from showcasing more projects',
      'Adding endorsements would strengthen your profile'
    ];

    res.status(200).json({
      success: true,
      name: userData.name,
      headline: userData.headline,
      profilepicture: userData.profilepicture || null,
      skills: userData.skills || [],
      certifications: userData.certifications || [],
      recommendations
    });

  } catch (error) {
    console.error('🔥 Error in /user-data:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: error.message
    });
  }
});


// Update Preferences - protected with JWT auth
app.post('/update-preferences', verifyAuthToken, async (req, res) => {
  try {
    const { email_notifications, frequency = 'weekly' } = req.body;
    const email = req.user.email;

    // Update in Supabase
    const { error } = await adminSupabase
      .from('users')
      .update({ 
        email_notifications,
        notification_frequency: frequency
      })
      .eq('email', email);

    if (error) {
      console.error('Supabase update error:', error);
      return res.status(500).json({ success: false, error: 'Update failed' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Subscribe or re-subscribe user - protected with JWT auth
app.post('/subscribe', verifyAuthToken, async (req, res) => {
  const { name, headline, skills, certifications } = req.body;
  const email = req.user.email;

  try {
    const { error } = await adminSupabase
      .from('users')
      .upsert([{
        email,
        name,
        headline,
        skills,
        certifications,
        subscribed: true
      }], { onConflict: 'email' });

    if (error) {
      console.error("Supabase insert error:", error.message);
      return res.status(500).json({ error: "Failed to subscribe user" });
    }

    res.json({ success: true, message: "User subscribed" });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: "Server error" });
  }
});

// Scrape Profile - protected with JWT auth
app.post('/scrape-profile', verifyAuthToken, async (req, res) => {
  const { profileUrl } = req.body;
  const email = req.user.email;

  if (!profileUrl || !profileUrl.includes('linkedin.com/in/')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid LinkedIn profile URL'
    });
  }

  try {
    // 1. Validate email
    console.log('📋 SCRAPE START for email:', email);

    if (!email || typeof email !== 'string' || email.trim() === '') {
      console.error('🚨 Invalid or missing email:', email);
      return res.status(400).json({
        success: false,
        message: 'Missing or invalid email from auth token'
      });
    }

    console.log('📧 Ensuring user exists for email:', email);

    // 2. First try the RLS bypass function
    let user = null;
    let userId = null;
    
    // Try the RLS bypass function first
    try {
      const { data: sqlResult, error: sqlError } = await adminSupabase.rpc(
        'create_user_bypass_rls',
        { user_email: email }
      );
      
      if (sqlError) {
        console.warn('⚠️ SQL bypass function failed:', sqlError.message);
        console.log('Falling back to standard upsert...');
      } else {
        console.log('✅ SQL bypass successful:', sqlResult);
        userId = sqlResult.user_id;
      }
    } catch (bypassError) {
      console.warn('⚠️ RLS bypass function not available:', bypassError.message);
    }
    
    // 3. Fetch user with retry logic
    let retries = 0;
    const maxRetries = 3;
    
    while (!user && retries < maxRetries) {
      console.log(`Attempt ${retries + 1} to fetch user...`);
      
      // Try standard upsert if SQL bypass didn't work
      if (!userId) {
        const { data: upsertResult, error: upsertError } = await adminSupabase
          .from('users')
          .upsert([{ email }], { 
            onConflict: 'email',
            returning: 'representation'
          })
          .select('*');

        const { data, error } = await adminSupabase.from('users').select('id, email').eq('email', email);

         console.log('🎯 Confirmed user after upsert:', data);

        
        if (upsertError) {
          console.error(`❌ Upsert error on attempt ${retries + 1}:`, upsertError);
        } else if (upsertResult && upsertResult[0]) {
          console.log('✅ User upserted successfully');
          user = upsertResult[0];
          break;
        }
      }
      
      // Fetch user by ID if we have one from SQL bypass
      if (userId) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
        
        if (userError) {
          console.error(`❌ Failed to fetch user by ID on attempt ${retries + 1}:`, userError);
        } else {
          console.log('✅ User fetched by ID successfully');
          user = userData;
          break;
        }
      }
      
      // Fetch user by email as fallback
      const { data: users, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .limit(1);
      
      if (fetchError) {
        console.error(`❌ Failed to fetch user by email on attempt ${retries + 1}:`, fetchError);
      } else if (users && users[0]) {
        console.log('✅ User fetched by email successfully');
        user = users[0];
        break;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }
    
    // Check if we successfully got a user
    if (!user) {
      console.error('❌ Failed to create/fetch user after multiple attempts');
      
      // Last resort - direct insert with admin client if available
      if (adminSupabase) {
        console.log('🔑 Trying admin direct insert as last resort');
        
        const { data: adminResult, error: adminError } = await adminSupabase
          .from('users')
          .upsert([{ email }], { 
            onConflict: 'email',
            returning: 'representation'
          })
          .select('*');
        
        if (adminError) {
          console.error('❌ Admin insert failed:', adminError);
        } else if (adminResult && adminResult[0]) {
          console.log('✅ Admin insert successful');
          user = adminResult[0];
        }
      }
      
      // If still no user, return error
      if (!user) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create/retrieve user in database'
        });
      }
    }

    console.log('👤 User record:', { id: user.id, email: user.email });

    // 4. Check plan limits
    const plan = user.plan || 'basic';
    const limits = { basic: 2, pro: 10, premium: 100 };
    const allowed = limits[plan];

    if ((user?.monthly_scrapes || 0) >= allowed) {
      return res.status(403).json({ 
        success: false,
        error: 'limit_reached',
        message: `Monthly limit of ${allowed} scrapes reached for ${plan} plan`
      });
    }

    // 5. Scrape LinkedIn profile
    console.log('🕸️ Starting LinkedIn scrape for URL:', profileUrl);
    const parsed = await scraper(profileUrl);
    console.log('✅ Scrape completed. Data keys:', Object.keys(parsed));

    // 6. Update user with scraped data
    console.log('💾 Updating user with scraped data');
    const { error: updateError } = await adminSupabase
      .from('users')
      .update({
        name: parsed.name,
        title: parsed.title,
        location: parsed.location,
        skills: parsed.skills,
        certifications: parsed.certifications,
        companies: parsed.companies,
        education: parsed.education,
        profilepicture: parsed.profilePicture || parsed.profilepicture || null,
        connections: parsed.connections ? parseInt(parsed.connections) : null,
        monthly_scrapes: (user?.monthly_scrapes || 0) + 1,
        last_scrape: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ Failed to update user with scraped data:', updateError);
      // Continue anyway - we still want to return the scraped data
    } else {
      console.log('✅ User updated with scraped data');
    }

    // 7. Log scrape event
    console.log('📝 Logging scrape event');
    const { error: logError } = await supabase
      .from('scrape_logs')
      .insert([{ 
        user_id: user.id,
        profile_url: profileUrl,
        scraped_at: new Date().toISOString()
      }]);
    
    if (logError) {
      console.warn('⚠️ Failed to log scrape event:', logError);
    } else {
      console.log('✅ Scrape event logged');
    }

    // 8. Send email notification (optional)
    try {
      console.log('📨 Sending email notification');
      await sendEmail(email, parsed.name, parsed.skills);
      console.log('✅ Email notification sent');
    } catch (emailError) {
      console.warn('⚠️ Failed to send email notification:', emailError);
    }

    // 9. Return success response
    console.log('🎉 Scrape process completed successfully');
    res.json({
      success: true,
      email,
      user_id: user.id,
      data: {
        name: parsed.name,
        title: parsed.title,
        location: parsed.location,
        skills: parsed.skills,
        certifications: parsed.certifications,
        companies: parsed.companies,
        education: parsed.education,
        profilepicture: parsed.profilePicture || parsed.profilepicture || null,
        connections: parsed.connections
      },
      meta: {
        scrapes_used: (user?.monthly_scrapes || 0) + 1,
        scrapes_allowed: allowed,
        plan: plan
      }
    });

  } catch (err) {
    console.error('❌ Scrape process error:', err);
    res.status(500).json({
      success: false,
      error: 'scrape_failed',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Rate limiter setup
const recommendationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Fixed: Recommendations (Rate-limited, plan-checked) - protected with auth
app.post('/recommendations', recommendationsLimiter, verifyAuthToken, async (req, res) => {
  try {
    const email = req.user.email;

    // Get user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('skills, name, plan, email_notifications, monthly_scrapes')
      .eq('email', email)
      .limit(1);

    if (userError) {
      return res.status(404).json({ error: 'User not found' });
    }

    const plan = user.plan || 'basic';
    const limits = { basic: 2, pro: 10, premium: Infinity };
    const usage = user.monthly_scrapes || 0;

    if (usage >= limits[plan]) {
      return res.status(403).json({ error: 'Monthly scrape limit reached' });
    }

    // Update scrape count
    await supabase
      .from('users')
      .update({ monthly_scrapes: usage + 1 })
      .eq('email', email);

    const skills = user.skills || [];
    const name = user.name || 'Professional';
    const wantsEmail = user.email_notifications !== false;

    const prompt = `I have these skills: ${skills.join(', ')}. Recommend 3 online courses and 2 certifications. Format as JSON: { courses: [], certifications: [] }.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0].message.content;
    let json;
    try {
      const match = text.match(/```json\n?([\\s\\S]+?)```/);
      json = match ? JSON.parse(match[1]) : JSON.parse(text);
    } catch (parseError) {
      // Fallback if JSON parsing fails
      json = { courses: [], certifications: [] };
    }

    const { courses = [], certifications = [] } = json;

    // Fetch live jobs
    let jobs = [];
    try {
      const jobsRes = await axios.post(`${process.env.BACKEND_URL || 'http://localhost:3000'}/jobs/remotive`, 
        { skills }, 
        { headers: { Authorization: req.headers.authorization } }
      );
      jobs = jobsRes.data.jobs || [];
    } catch (jobError) {
      console.error('Jobs fetch error:', jobError.message);
    }

    // Send via email if opted in
    if (wantsEmail) {
      try {
        await sendEmail(email, name, {
          primarySkill: skills[0] || 'Your Skills',
          email: email,
          courses,
          certifications,
          jobs
        });
      } catch (emailError) {
        console.error('Email send error:', emailError.message);
      }
    }

    res.json({ success: true, courses, certifications, jobs, emailSent: wantsEmail });
  } catch (err) {
    console.error('Recommendation error:', err.message);
    res.status(500).json({ error: 'recommendation_failed' });
  }
});

// Subscription Endpoint - protected with auth
app.post('/subscription', verifyAuthToken, async (req, res) => {
  const { plan, paymentMethod } = req.body;
  const email = req.user.email;

  if (!plan) {
    return res.status(400).json({ error: 'Missing plan' });
  }

  // Update user plan in Supabase
  await supabase.from('users').update({ plan, subscribed: true }).eq('email', email);

  if (plan === 'basic') {
    return res.json({ success: true });
  }

  if (paymentMethod === 'stripe') {
    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Skillarly ${plan}` },
          unit_amount: plan === 'pro' ? 500 : 1500,
        },
        quantity: 1,
      }],
      mode: 'subscription',
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    return res.json({ stripeUrl: session.url });
  }

  if (paymentMethod === 'mpesa') {
    // Handle M-Pesa payment
    const mpesaResult = await sendMpesaPush({
      amount: plan === 'pro' ? 500 : 1500,
      phone: req.body.phone || '2547XXXXXXXX',
      email
    });

    return res.json({ mpesaStatus: 'initiated', response: mpesaResult });
  }

  res.status(400).json({ error: 'Invalid payment method' });
});

// Log Scrape - protected with auth
app.post('/scrape-log', verifyAuthToken, async (req, res) => {
  try {
    const email = req.user.email;
    
    // Get user ID
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query(`INSERT INTO scrape_logs (user_id) VALUES ($1)`, [user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Scrape log error:', error);
    res.status(500).json({ error: 'Failed to log scrape' });
  }
});

// Send Email - protected with auth
app.post('/send-email', verifyAuthToken, async (req, res) => {
  const email = req.user.email;
  // Trigger email send from email.js/recommendationEmail.js
  res.json({ success: true, simulated: true });
});

// M-Pesa Callback
app.post('/mpesa/callback', (req, res) => {
  console.log('✅ M-Pesa Callback Received:', req.body);
  res.sendStatus(200);
});

// Reset monthly scrapes (for CRON jobs)
app.post('/reset-scrapes', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  try {
    await supabase.from('users').update({ monthly_scrapes: 0 });
    res.json({ success: true });
  } catch (e) {
    console.error('Reset scrapes error:', e);
    res.status(500).json({ error: 'reset_failed' });
  }
});

// Job APIs - protected with auth
app.post('/jobs/remotive', verifyAuthToken, async (req, res) => {
  const { skills } = req.body;
  if (!skills || !skills.length) return res.status(400).json({ error: 'No skills provided' });

  try {
    const query = encodeURIComponent(skills[0]);
    const response = await fetch(`https://remotive.io/api/remote-jobs?search=${query}`);
    const data = await response.json();

    const jobs = data.jobs.slice(0, 5).map(job => ({
      title: job.title,
      company: job.company_name,
      description: job.description.replace(/<[^>]+>/g, '').slice(0, 160) + '...',
      link: job.url
    }));

    res.json({ jobs });
  } catch (e) {
    console.error('Remotive error:', e);
    res.status(500).json({ error: 'remotive_failed' });
  }
});

app.post('/jobs/jsearch', verifyAuthToken, async (req, res) => {
  const { skills } = req.body;
  if (!skills || !skills.length) return res.status(400).json({ error: 'No skills provided' });

  try {
    const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query: skills[0],
        num_pages: 1
      },
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    });

    const jobs = response.data.data.slice(0, 5).map(job => ({
      title: job.job_title,
      company: job.employer_name,
      description: job.job_description.slice(0, 160) + '...',
      link: job.job_apply_link || job.job_google_link
    }));

    res.json({ jobs });
  } catch (e) {
    console.error('JSearch error:', e.response?.data || e.message);
    res.status(500).json({ error: 'jsearch_failed' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: `Route ${req.originalUrl} not found`
  });
});

// Helper Functions

// M-Pesa Token Helper
async function getMpesaToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await res.json();
  return data.access_token;
}

// M-Pesa STK Push Helper
async function sendMpesaPush({ amount, phone, email }) {
  const token = await getMpesaToken();
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

  const res = await fetch("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: email,
      TransactionDesc: "Skillarly Subscription"
    })
  });

  return await res.json();
}

// Server Startup
const PORT = process.env.PORT || 3000;

app.on('redis-connected', () => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL}`);
  });
});

//404 errors
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: `Route ${req.originalUrl} not found`
  });
});
