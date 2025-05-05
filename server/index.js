import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import stripePackage from 'stripe';
import supabase from './supabase.js';
import scraper from './scraper.js';
import { sendEmail } from './email.js';
import { Configuration, OpenAIApi } from 'openai';
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
const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY
}));

// Middleware
app.use(cors());
app.use(express.json());

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


// Redirect LinkedIn profile visits to mobile with profile param
app.get('/go', (req, res) => {
  const ref = req.get('Referrer') || '';
  if (ref.includes('linkedin.com/in/')) {
    return res.redirect(`/mobile.html?profile=${encodeURIComponent(ref)}`);
  }
  return res.redirect('/mobile.html');
});

// Scrape LinkedIn profile and save data
app.post('/scrape-profile', async (req, res) => {
  const { profileUrl, email: passedEmail } = req.body;
  const email = passedEmail || `autogen_${Date.now()}@skillarly.ai`;

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
  res.json({ success: true, userId: result.rows[0].id });
});

// ✅ User Info
app.get('/user-info', async (req, res) => {
  const { email } = req.query;
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

// ✅ Update Preferences
app.post('/update-preferences', async (req, res) => {
  const { email, email_notifications, frequency = 'weekly' } = req.body;
  const userId = await getUserId(email);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  await pool.query(`
    INSERT INTO preferences (user_id, email_notifications, frequency)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE 
      SET email_notifications = $2, frequency = $3
  `, [userId, email_notifications, frequency]);

  res.json({ success: true });
});

 

// ✅ Subscribe or re-subscribe user
app.post('/subscribe', async (req, res) => {
  const { email, name, headline, skills, certifications } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required" });

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



// Subscription Endpoint
app.post('/subscribe', async (req, res) => {
  const { email, plan, paymentMethod } = req.body;

  if (!email || !plan) {
    return res.status(400).json({ error: 'Missing email or plan' });
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
    // Obtain M-Pesa Access Token
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const tokenResponse = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    const accessToken = tokenResponse.data.access_token;

    // Initiate M-Pesa STK Push
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

    const stkPushResponse = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: plan === 'pro' ? 500 : 1500,
      PartyA: '2547XXXXXXXX', // Replace with user's phone number
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: '2547XXXXXXXX', // Replace with user's phone number
      CallBackURL: 'https://skillarly.com/mpesa/callback',
      AccountReference: email,
      TransactionDesc: `Skillarly ${plan} Subscription`,
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return res.json({ mpesaStatus: 'initiated', response: stkPushResponse.data });
  }

  res.status(400).json({ error: 'Invalid payment method' });
});




// ✅ Log Scrape
app.post('/scrape-log', async (req, res) => {
  const { email } = req.body;
  const userId = await getUserId(email);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  await pool.query(`INSERT INTO scrape_logs (user_id) VALUES ($1)`, [userId]);
  res.json({ success: true });
});

// ✅ Recommendations (Rate-limited, plan-checked)
app.post('/recommendations', recommendationsLimiter, async (req, res) => {
  const { email } = req.body;
  const userId = await getUserId(email);
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

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

  res.json({
    success: true,
    courses: [{ title: 'React Advanced', description: 'Hooks + Patterns', source: 'Coursera', link: '#' }],
    certifications: [{ title: 'AWS Dev Cert', description: 'Cloud skills', source: 'Udemy', link: '#' }],
    jobs: [{ title: 'Remote Frontend Dev', company: 'RemoteCo', description: 'React, Tailwind', link: '#' }]
  });
});

// ✅ Trigger Email (optional)
app.post('/send-email', async (req, res) => {
  const { email } = req.body;
  // Trigger email send from email.js/recommendationEmail.js
  res.json({ success: true, simulated: true });
});

// ✅ M-Pesa Callback (optional logging)
app.post('/mpesa/callback', (req, res) => {
  console.log('✅ M-Pesa Callback Received:', req.body);
  res.sendStatus(200);
});



// Reset monthly scrapes (for CRON jobs)
app.post('/reset-scrapes', async (req, res) => {
  try {
    await supabase.from('users').update({ monthly_scrapes: 0 });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'reset_failed' });
  }
});

// User info (used in dashboard)
app.get('/user-info', async (req, res) => {
  const { email } = req.query;
  try {
    const { data, error } = await supabase.from('users').select('*').eq('email', email).single();
    if (error) return res.status(404).json({ error: 'not_found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'fetch_failed' });
  }
});


//const fetch = require('node-fetch');

//Remotive jobs
app.post('/jobs/remotive', async (req, res) => {
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


//Jsearch jobs
app.post('/jobs/jsearch', async (req, res) => {
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


// AI-powered course and job suggestions
app.post('/recommendations', async (req, res) => {
  const { email } = req.body;

  try {
    const { data: user } = await supabase.from('users')
      .select('skills, name, plan, email_notifications')
      .eq('email', email)
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
      await sendEmail(email, name, {
        primarySkill: skills[0] || 'Your Skills',
        email,
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



//Save Email prefererences
app.post('/update-preferences', async (req, res) => {
  const { email, email_notifications } = req.body;
  try {
    await supabase.from('users').update({ email_notifications }).eq('email', email);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'update_failed' });
  }
});


// ✅ Root
app.get('/', (req, res) => res.send('✅ Skillarly backend is live.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Skillarly backend running on http://localhost:${PORT}`);
});
