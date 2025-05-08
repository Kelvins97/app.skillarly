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

// Initialize modules with config
dotenv.config();
const app = express();
const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());


// Allow requests from your frontend domain
app.use(cors({
  origin: 'https://skillarly.vercel.app', 
  credentials: true // For cookies/session
}));

// Session setup (required for Passport)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // For HTTPS
    sameSite: 'none' // Required for cross-origin cookies
  }
}));

// Mount auth routes
app.use('/auth', require('./auth/linkedin'));

// In linkedin.js (backend callback route)
app.get('/auth/linkedin/callback',
  passport.authenticate('linkedin', { failureRedirect: '/login-failed' }),
  (req, res) => {
    // Generate a JWT token
    const token = generateSecureToken(req.user);
    
    // Redirect to FRONTEND dashboard with token
    res.redirect(`https://skillarly.vercel.app/dashboard?token=${token}`);
  }
);

// Rate limiter setup
const recommendationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many requests. Please try again later.'
});

// 🧠 Helper: get user ID by email
async function getUserId(email) {
  const res = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return res.rows[0]?.id || null;
}

// ✅ M-Pesa Token Helper
async function getMpesaToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await res.json();
  return data.access_token;
}

// ✅ M-Pesa STK Push Helper
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

// Authentication middleware
function verifyAuthToken(req, res, next) {
  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    // Decode and verify the token
    const decoded = Buffer.from(token, 'base64').toString();
    const userData = JSON.parse(decoded);
    
    // Check if token is expired (e.g., 24 hour validity)
    const now = Date.now();
    if (now - userData.timestamp > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    }
    
    // Add user data to request for use in route handlers
    req.user = userData;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid authentication token' 
    });
  }
}

// Redirect LinkedIn profile visits to home with profile param
app.get('/go', (req, res) => {
  const ref = req.get('Referrer') || '';
  if (ref.includes('linkedin.com/in/')) {
    return res.redirect(`/index.html?profile=${encodeURIComponent(ref)}`);
  }
  return res.redirect('/index.html');
});

// Scrape LinkedIn profile and save data - protected with auth
app.post('/scrape-profile', verifyAuthToken, async (req, res) => {
  const { profileUrl } = req.body;
  const email = req.user.email || `autogen_${Date.now()}@skillarly.ai`;

  // Additional verification: ensure user is scraping their own profile
  if (!profileUrl.includes(req.user.id)) {
    return res.status(403).json({
      success: false,
      message: 'You can only analyze your own LinkedIn profile'
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

// ✅ Auth/Login
app.post('/auth/login', async (req, res) => {
  const { email, name, photo_url } = req.body;
  const result = await pool.query(`
    INSERT INTO users (email, name, photo_url)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `, [email, name, photo_url]);
  
  // Generate authentication token
  const userData = {
    id: result.rows[0].id,
    email,
    name,
    timestamp: Date.now()
  };
  
  const token = Buffer.from(JSON.stringify(userData)).toString('base64');
  
  res.json({ 
    success: true, 
    userId: result.rows[0].id,
    token
  });
});

// ✅ User Info - protected with auth
app.get('/user-info', verifyAuthToken, async (req, res) => {
  const email = req.user.email;
  
  // Ensure the requesting user is accessing their own data
  if (req.query.email && req.query.email !== email) {
    return res.status(403).json({
      success: false,
      message: 'You can only access your own profile data'
    });
  }
  
  const result = await pool.query(`
    SELECT u.id, u.email, s.plan, p.email_notifications,
      (SELECT COUNT(*) FROM scrape_logs 
       WHERE user_id = u.id AND DATE_TRUNC('month', scraped_at) = DATE_TRUNC('month', CURRENT_DATE)) AS monthly_scrapes
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_active
    LEFT JOIN preferences p ON p.user_id = u.id
    WHERE u.email = $1
  `, [email]);
  res.json(result.rows[0] || {});
});

// ✅ Update Preferences - protected with auth
app.post('/update-preferences', verifyAuthToken, async (req, res) => {
  const { email_notifications, frequency = 'weekly' } = req.body;
  const userId = req.user.id;

  await pool.query(`
    INSERT INTO preferences (user_id, email_notifications, frequency)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE 
      SET email_notifications = $2, frequency = $3
  `, [userId, email_notifications, frequency]);

  res.json({ success: true });
});

// ✅ Subscribe or re-subscribe user - protected with auth
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
    res.status(500).json({ error: "Server error" });
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
      success_url: 'https://skillarly.com/success',
      cancel_url: 'https://skillarly.com/cancel',
    });

    return res.json({ stripeUrl: session.url });
  }

  if (paymentMethod === 'mpesa') {
    // Handle M-Pesa payment
    const mpesaResult = await sendMpesaPush({
      amount: plan === 'pro' ? 500 : 1500,
      phone: req.body.phone || '2547XXXXXXXX', // Get phone from request or user profile
      email
    });

    return res.json({ mpesaStatus: 'initiated', response: mpesaResult });
  }

  res.status(400).json({ error: 'Invalid payment method' });
});

// ✅ Log Scrape - protected with auth
app.post('/scrape-log', verifyAuthToken, async (req, res) => {
  const userId = req.user.id;
  await pool.query(`INSERT INTO scrape_logs (user_id) VALUES ($1)`, [userId]);
  res.json({ success: true });
});

// ✅ Recommendations (Rate-limited, plan-checked) - protected with auth
app.post('/recommendations', recommendationsLimiter, verifyAuthToken, async (req, res) => {
  const userId = req.user.id;

  const planRes = await pool.query(`
    SELECT plan FROM subscriptions WHERE user_id = $1 AND is_active = TRUE
  `, [userId]);
  const plan = planRes.rows[0]?.plan || 'basic';

  const usageRes = await pool.query(`
    SELECT COUNT(*) FROM scrape_logs 
    WHERE user_id = $1 
    AND DATE_TRUNC('month', scraped_at) = DATE_TRUNC('month', CURRENT_DATE)
  `, [userId]);
  const usage = parseInt(usageRes.rows[0]?.count || '0', 10);
  const limits = { basic: 2, pro: 10, premium: Infinity };

  if (usage >= limits[plan]) {
    return res.status(403).json({ error: 'Monthly scrape limit reached' });
  }

  await pool.query(`INSERT INTO scrape_logs (user_id) VALUES ($1)`, [userId]);

  try {
    const { data: user } = await supabase.from('users')
      .select('skills, name, plan, email_notifications')
      .eq('email', req.user.email)
      .single();

    const skills = user.skills || [];
    const name = user.name || 'Professional';
    const wantsEmail = user.email_notifications !== false;

    const prompt = `I have these skills: ${skills.join(', ')}. Recommend 3 online courses and 2 certifications. Format as JSON: { courses, certifications }.`;

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.data.choices[0].message.content;
    const match = text.match(/```json\\n?([\\s\\S]+?)```/);
    const json = match ? JSON.parse(match[1]) : JSON.parse(text);
    const { courses = [], certifications = [] } = json;

    // Fetch live jobs
    const jobsRes = await axios.post('http://localhost:3000/jobs/remotive', { skills });
    const jobs = jobsRes.data.jobs || [];

    // Send via email if opted in
    if (wantsEmail) {
      await sendEmail(req.user.email, name, {
        primarySkill: skills[0] || 'Your Skills',
        email: req.user.email,
        courses,
        certifications,
        jobs
      });
    }

    res.json({ success: true, courses, certifications, jobs, emailSent: wantsEmail });
  } catch (err) {
    console.error('Recommendation error:', err.message);
    res.status(500).json({ error: 'recommendation_failed' });
  }
});

// ✅ Trigger Email (optional) - protected with auth
app.post('/send-email', verifyAuthToken, async (req, res) => {
  // Email is determined from authenticated user
  const email = req.user.email;
  // Trigger email send from email.js/recommendationEmail.js
  res.json({ success: true, simulated: true });
});

// ✅ M-Pesa Callback (optional logging)
app.post('/mpesa/callback', (req, res) => {
  console.log('✅ M-Pesa Callback Received:', req.body);
  res.sendStatus(200);
});

// Reset monthly scrapes (for CRON jobs) - should be restricted to admin or cron access
app.post('/reset-scrapes', async (req, res) => {
  // This should have an admin authentication check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  try {
    await supabase.from('users').update({ monthly_scrapes: 0 });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'reset_failed' });
  }
});

// API for user data - protected with auth
app.get('/api/user-data', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Fetch user data from your database
    const { data: userData } = await supabase
      .from('users')
      .select('name, skills, certifications, headline')
      .eq('email', req.user.email)
      .single();
    
    if (!userData) {
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
      profilePicture: null, // You could fetch this from storage or the user table
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

// Remotive jobs API - protected with auth
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

// Jsearch jobs API - protected with auth
app.post('/jobs/jsearch', verifyAuthToken, async (req, res) => {
  const { skills } = req.body;
  if (!skills || !skills.length) return res.status(400).json({ error: 'No skills provided' });

  try {
    const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query: skills[0], // top skill
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


// ✅ Root
app.get('/', (req, res) => res.send('✅ Skillarly backend is live.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Skillarly backend running on http://localhost:${PORT}`);
});
