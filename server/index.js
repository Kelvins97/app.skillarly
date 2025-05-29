import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import stripePackage from 'stripe';
import supabase from './supabase.js';
import { adminSupabase } from './supabase.js';
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
import authRoutes from './authRoutes.js'
import devSeedRoute from './dev-seed.js';
import resumeRoutes from './routes/resume.js';
import cron from 'node-cron';
import './cronJob.js';

// 1. Environment Configuration
dotenv.config();

// 2. Initialize Core Services
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redisClient = createClient({ url: process.env.REDIS_URL });

// Serve uploaded resumes statically -- Resume Routes
app.use(express.json());
app.use('/upload-resume', resumeRoutes);


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

// Rate limit OpenAI-related routes
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many AI requests. Try again later.'
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

// ✅ FIXED /user-info - Separate queries for reliability
app.get('/user-info', verifyAuthToken, async (req, res) => {
  const { email } = req.user;

  try {
    // Get user data first
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, name, email, plan, email_notifications')
      .eq('email', email)
      .single();

    if (userError) throw userError;

    // Get latest resume - using user_email since that's your current FK
    const { data: resume, error: resumeError } = await supabase
      .from('resumes')
      .select('uploaded_at')
      .eq('user_email', email)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get latest recommendation log
    const { data: lastRec, error: recError } = await supabase
      .from('recommendation_logs')
      .select('recommended_at')
      .eq('user_id', user.id)
      .order('recommended_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      success: true,
      id: user.id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      email_notifications: user.email_notifications,
      resume_uploaded_at: resume?.uploaded_at || null,
      last_recommended_at: lastRec?.recommended_at || null
    });

  } catch (error) {
    console.error('❌ Error in /user-info:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load user info' });
  }
});

// ✅ FIXED /user-data - Using current schema
app.get('/user-data', verifyAuthToken, async (req, res) => {
  const email = req.user.email;

  try {
    // Get user data first
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, plan, skills, certifications, education, companies, parsed_resume')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get latest resume data using user_email (your current FK)
    const { data: latestResume, error: resumeError } = await supabase
      .from('resumes')
      .select('parsed_data, uploaded_at')
      .eq('user_email', email)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get recommendation logs
    const { data: recLogs, error: logsError } = await supabase
      .from('recommendation_logs')
      .select('recommended_at')
      .eq('user_id', user.id)
      .order('recommended_at', { ascending: false })
      .limit(5);

    // Merge resume data (prioritize latest resume over user table)
    const resumeData = latestResume?.parsed_data || user.parsed_resume;

    return res.json({
      success: true,
      user_id: user.id,
      plan: user.plan,
      
      // Resume data (prioritize resumes table)
      parsed_resume: resumeData,
      uploaded_at: latestResume?.uploaded_at || null,
      
      // User profile data (can be from either table)
      skills: latestResume?.parsed_data?.skills || user.skills,
      certifications: latestResume?.parsed_data?.certifications || user.certifications,
      education: latestResume?.parsed_data?.education || user.education,
      companies: latestResume?.parsed_data?.companies || user.companies,
      
      // Recommendation history
      last_recommended_at: recLogs?.[0]?.recommended_at || null,
      recommendation_count: recLogs?.length || 0
    });

  } catch (err) {
    console.error('❌ Error in /user-data:', err);
    res.status(500).json({ success: false, message: 'Internal error' });
  }
});

// 🆕 HELPER: Get user ID by email (for upload process)
app.get('/user-id', verifyAuthToken, async (req, res) => {
  const { email } = req.user;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      user_id: user.id,
      email: email
    });

  } catch (err) {
    console.error('❌ Error in /user-id:', err);
    res.status(500).json({ success: false, message: 'Internal error' });
  }
});

// 🆕 BONUS: Combined endpoint for dashboard
app.get('/user-dashboard', verifyAuthToken, async (req, res) => {
  const email = req.user.email;

  try {
    // Single comprehensive query
    const { data: dashboardData, error } = await supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        plan,
        email_notifications,
        skills,
        certifications,
        education,
        companies,
        resumes (
          id,
          uploaded_at,
          parsed_data
        ),
        recommendation_logs (
          recommended_at
        )
      `)
      .eq('email', email)
      .order('resumes.uploaded_at', { ascending: false })
      .order('recommendation_logs.recommended_at', { ascending: false })
      .single();

    if (error) throw error;

    const latestResume = dashboardData.resumes?.[0];
    const recentRecommendations = dashboardData.recommendation_logs?.slice(0, 5) || [];

    res.json({
      success: true,
      user: {
        id: dashboardData.id,
        name: dashboardData.name,
        email: dashboardData.email,
        plan: dashboardData.plan,
        email_notifications: dashboardData.email_notifications
      },
      resume: {
        uploaded_at: latestResume?.uploaded_at || null,
        has_resume: !!latestResume,
        parsed_data: latestResume?.parsed_data || null
      },
      profile: {
        skills: latestResume?.parsed_data?.skills || dashboardData.skills,
        certifications: latestResume?.parsed_data?.certifications || dashboardData.certifications,
        education: latestResume?.parsed_data?.education || dashboardData.education,
        companies: latestResume?.parsed_data?.companies || dashboardData.companies
      },
      recommendations: {
        last_recommended_at: recentRecommendations[0]?.recommended_at || null,
        total_count: recentRecommendations.length,
        recent_history: recentRecommendations.map(log => log.recommended_at)
      }
    });

  } catch (error) {
    console.error('❌ Error in /user-dashboard:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
});


/* Rate limiting middleware
app.use('/update-preferences', rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50 // Limit each IP to 50 requests per window
}));

// Request validation middleware
const validatePreferences = (req, res, next) => {
  const schema = Joi.object({
    email_notifications: Joi.boolean().required(),
    frequency: Joi.string().valid('daily', 'weekly', 'monthly')
  });
  // ... validation logic ...
};*/



// Update Preferences - protected with JWT auth
app.post('/update-preferences', verifyAuthToken, async (req, res) => {
  const { email_notifications, frequency = 'weekly' } = req.body;
  const email = req.user?.email;

  // Log entry point with request context
  console.log(`Preferences update initiated for ${email}`, {
    endpoint: '/update-preferences',
    notification_change: typeof email_notifications,
    frequency_requested: frequency
  });

  if (!email) {
    console.error('Unauthorized preferences update attempt - Missing email in JWT');
    return res.status(401).json({ 
      error: "Unauthorized",
      userMessage: "Authentication required to update preferences"
    });
  }

  // Validate input parameters
  const validFrequencies = new Set(['daily', 'weekly', 'monthly']);
  if (typeof email_notifications !== 'boolean' || !validFrequencies.has(frequency)) {
    console.error(`Invalid preferences input for ${email}`, {
      received: { email_notifications, frequency }
    });
    return res.status(400).json({
      error: "Invalid input",
      userMessage: "Please provide valid notification preferences"
    });
  }

  try {
    const { data, error: updateError } = await adminSupabase
      .from('users')
      .update({
        email_notifications,
        notification_frequency: frequency,
        preferences_updated_at: new Date().toISOString()
      })
      .eq('email', email)
      .select('email'); // Verify update success

    if (updateError) {
      console.error(`Supabase update error for ${email}:`, {
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint
      });
      return res.status(500).json({
        error: "Database update failed",
        userMessage: "Failed to save preferences. Please try again."
      });
    }

    if (!data || data.length === 0) {
      console.error(`User not found during preferences update: ${email}`);
      return res.status(404).json({
        error: "User not found",
        userMessage: "Account not found. Please contact support."
      });
    }

    // Audit log for successful update
    console.log(`Preferences updated successfully for ${email}`, {
      new_settings: { email_notifications, frequency }
    });

    return res.json({
      success: true,
      message: "Notification preferences updated",
      updatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error(`Critical error updating preferences for ${email}:`, {
      error: err.stack || err,
      body: { ...req.body, email_notifications: typeof email_notifications } // Sanitized
    });
    
    return res.status(500).json({
      error: "Internal server error",
      userMessage: "Failed to update preferences due to a system error."
    });
  }
});

// Subscribe or re-subscribe user - protected with JWT auth
app.post('/subscribe', verifyAuthToken, async (req, res) => {
  const { name, headline, skills, certifications } = req.body;
  const email = req.user?.email;

  // Log entry point with basic request info
  console.log(`Subscription attempt started for email: ${email}`, {
    endpoint: '/subscribe',
    user: email
  });

  if (!email) {
    console.error('Authorization failed - No email in JWT');
    return res.status(401).json({ error: "Unauthorized - Invalid credentials" });
  }

  try {
    // Log subscription payload (sanitized)
    console.log(`Processing subscription update for ${email}`, {
      fields: { name: !!name, headline: !!headline, skills: skills?.length, certifications: certifications?.length }
    });

    const { data, error: upsertError } = await adminSupabase
      .from('users')
      .upsert([{
        email,
        name,
        headline,
        skills,
        certifications,
        subscribed: true,
        last_subscribed: new Date().toISOString()
      }], { 
        onConflict: 'email',
        returning: 'minimal' // Remove if you need the returned data
      });

    if (upsertError) {
      console.error(`Supabase upsert error for ${email}:`, {
        code: upsertError.code,
        message: upsertError.message,
        details: upsertError.details
      });
      return res.status(500).json({ 
        error: "Failed to update subscription",
        userMessage: "We encountered an error processing your subscription. Please try again later."
      });
    }

    // Log successful subscription
    console.log(`Subscription updated successfully for ${email}`);
    
    return res.json({ 
      success: true,
      message: "Subscription updated successfully",
      updated: true
    });

  } catch (err) {
    console.error(`Critical error during subscription for ${email}:`, {
      error: err.stack || err,
      body: req.body // Caution: Only log non-sensitive data
    });
    
    return res.status(500).json({
      error: "Internal server error",
      userMessage: "A system error occurred. Our team has been notified."
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

    // 1. Fetch user with admin privileges
    const { data: users, error: userError } = await adminSupabase
      .from('users')
      .select('id, skills, name, plan, email_notifications, monthly_scrapes')
      .eq('email', email)
      .limit(1);

    const user = users?.[0];

    if (userError || !user) {
      console.warn('❌ User not found or fetch error:', userError?.message);
      return res.status(404).json({ error: 'User not found' });
    }

    const plan = user.plan || 'basic';
    const usage = user.monthly_scrapes || 0;
    const limits = { basic: 2, pro: 10, premium: Infinity };
    const allowed = limits[plan];

    if (usage >= allowed) {
      return res.status(403).json({ error: 'Monthly scrape limit reached' });
    }

    // 2. Update scrape count
    await adminSupabase
      .from('users')
      .update({ monthly_scrapes: usage + 1 })
      .eq('id', user.id);

    const skills = user.skills || [];
    const name = user.name || 'Professional';
    const wantsEmail = user.email_notifications !== false;

    // 3. Generate OpenAI-based recommendations
    const prompt = `I have these skills: ${skills.join(', ')}. Recommend 3 online courses and 2 certifications. Format as JSON: { courses: [], certifications: [] }.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0].message.content;
    let json;
    try {
      const match = text.match(/```json\n?([\s\S]+?)```/);
      json = match ? JSON.parse(match[1]) : JSON.parse(text);
    } catch (parseError) {
      console.warn('⚠️ Failed to parse AI JSON:', parseError.message);
      json = { courses: [], certifications: [] };
    }

    const { courses = [], certifications = [] } = json;

    // 4. Fetch live job recommendations
    let jobs = [];
    try {
      const jobsRes = await axios.post(
        `${process.env.BACKEND_URL || 'http://localhost:3000'}/jobs/remotive`,
        { skills },
        { headers: { Authorization: req.headers.authorization } }
      );
      jobs = jobsRes.data.jobs || [];
    } catch (jobError) {
      console.warn('⚠️ Jobs fetch error:', jobError.message);
    }

    // 5. Optional email summary
    if (wantsEmail) {
      try {
        await sendEmail(email, name, {
          primarySkill: skills[0] || 'Your Skills',
          email,
          courses,
          certifications,
          jobs
        });
      } catch (emailError) {
        console.warn('⚠️ Email send error:', emailError.message);
      }
    }

    res.json({ success: true, courses, certifications, jobs, emailSent: wantsEmail });
  } catch (err) {
    console.error('❌ Recommendation error:', err.message);
    res.status(500).json({ error: 'recommendation_failed' });
  }
});


app.post('/subscription', verifyAuthToken, async (req, res) => {
  const { plan, paymentMethod, phone } = req.body;
  const email = req.user.email;

  if (!plan) {
    return res.status(400).json({ error: 'Missing plan' });
  }

  console.log(`🛒 Subscription request: ${email} → ${plan} via ${paymentMethod || 'unspecified'}`);

  try {
    // 1. Fetch user ID (required for subscriptions table)
    const { data: users, error: fetchError } = await adminSupabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1);

    const user = users?.[0];

    if (fetchError || !user) {
      console.error('❌ Failed to fetch user:', fetchError?.message || 'User not found');
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = user.id;

    // 2. Update user record with new plan and flag
    const { error: updateError } = await adminSupabase
      .from('users')
      .update({ plan, subscribed: plan !== 'basic' })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Failed to update user plan:', updateError.message);
      return res.status(500).json({ error: 'Failed to update plan' });
    }

    // 3. Handle FREE plan immediately
    if (plan === 'basic') {
      return res.json({ success: true });
    }

    // 4. STRIPE Subscription
    if (paymentMethod === 'stripe') {
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

    // 5. M-PESA Subscription
    if (paymentMethod === 'mpesa') {
      const mpesaResult = await sendMpesaPush({
        amount: plan === 'pro' ? 500 : 1500,
        phone: phone || '2547XXXXXXXX',
        email
      });

      return res.json({ mpesaStatus: 'initiated', response: mpesaResult });
    }

    return res.status(400).json({ error: 'Invalid payment method' });

  } catch (err) {
    console.error('💥 Subscription processing error:', err.message);
    return res.status(500).json({ error: 'subscription_failed', message: err.message });
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
