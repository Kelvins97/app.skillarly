import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import stripePackage from 'stripe';
import supabase from './supabase.js';
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

// Protected Routes (using JWT token)

// Fixed: User Info - protected with JWT auth
app.get('/user-info', verifyAuthToken, async (req, res) => { 
  try {
    const email = req.user.email;
    
    // Get user info from Supabase
    const { data: userData, error } = await supabase
      .from('users')
      .select('id, email, name, email_notifications, plan, profilePicture')
      .eq('email', email)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get subscription info if exists
    const planResult = await pool.query(`
      SELECT plan FROM subscriptions WHERE user_email = $1 AND is_active = TRUE
    `, [email]);
    
    const plan = planResult.rows[0]?.plan || userData.plan || 'basic';

    // Get monthly scrapes count
    const scrapeResult = await pool.query(`
      SELECT COUNT(*) as count FROM scrape_logs sl
      JOIN users u ON u.id = sl.user_id
      WHERE u.email = $1 
      AND DATE_TRUNC('month', sl.scraped_at) = DATE_TRUNC('month', CURRENT_DATE)
    `, [email]);
    
    const monthly_scrapes = parseInt(scrapeResult.rows[0]?.count || '0', 10);

    res.json({
      success: true,
      id: userData.id,
      email: userData.email,
      name: userData.name,
      plan: plan,
      monthly_scrapes: monthly_scrapes,
      email_notifications: userData.email_notifications !== false,
      profilePicture: userData.profilePicture || null
    });

  } catch (error) {
    console.error('Error in /user-info:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


// Fixed: API for user data - protected with auth
app.get('/user-data', verifyAuthToken, async (req, res) => {
  try {
    const email = req.user.email;
    
    // Fetch user data from Supabase
    const { data: userData, error } = await supabase
      .from('users')
      .select('name, skills, certifications, headline, profilePicture')
      .eq('email', email)
      .single();
    
    if (error || !userData) {
      return res.status(404).json({
        success: false,
        message: 'User data not found'
      });
    }
    
    // Sample recommendations based on skills
    const recommendations = [
      'Consider learning GraphQL for API development',
      'Your profile would benefit from showcasing more projects',
      'Adding endorsements would strengthen your profile'
    ];
    
    res.status(200).json({
      success: true,
      name: userData.name,
      headline: userData.headline,
      profilePicture: userData.profilePicture || null,
      skills: userData.skills || [],
      certifications: userData.certifications || [],
      recommendations
    });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching user data' 
    });
  }
});


// Update Preferences - protected with JWT auth
app.post('/update-preferences', verifyAuthToken, async (req, res) => {
  try {
    const { email_notifications, frequency = 'weekly' } = req.body;
    const email = req.user.email;

    // Update in Supabase
    const { error } = await supabase
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
    const { error } = await supabase
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
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    const limits = { basic: 2, pro: 10, premium: 100 };
    const allowed = limits[user?.plan || 'basic'];

    if (user?.monthly_scrapes >= allowed) {
      return res.status(403).json({ error: 'limit_reached' });
    }

  const parsed = await scraper(profileUrl);
  await supabase.from('users').upsert([{
  email,
  name: parsed.name,
  skills: parsed.skills,
  certifications: parsed.certifications,
  profilePicture: parsed.profilePicture || null,
  monthly_scrapes: (user?.monthly_scrapes || 0) + 1,
  last_scrape: new Date().toISOString(),
  plan: user?.plan || 'basic',
  subscribed: true
  }], { onConflict: 'email' });


    await sendEmail(email, parsed.name, parsed.skills);
    res.json({ success: true, email });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: 'scrape_failed' });
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
      .single();

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
      .single();

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
