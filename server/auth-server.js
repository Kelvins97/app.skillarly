import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { initializeAuth } from './auth/linkedin.js';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Configure CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://skillarly.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON request bodies
app.use(express.json());

// Initialize Redis client
const redisClient = process.env.REDIS_URL ? 
  createClient({ url: process.env.REDIS_URL }) : 
  null;

// Set up session middleware
const configureSession = () => {
  // Set up session options
  const sessionOptions = {
    secret: process.env.SESSION_SECRET || 'default_secret_for_dev',
    resave: false,
    saveUninitialized: true, // Important: Set to true to save the oauth state
    name: 'skillarly.sid', // Custom cookie name
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true
    }
  };

  // Use Redis store if Redis is configured
  if (redisClient) {
    sessionOptions.store = new RedisStore({ client: redisClient });
  } else {
    console.warn('⚠️ No Redis URL provided - using in-memory session store');
    // In-memory store will be used automatically
  }

  return session(sessionOptions);
};

// Initialize session
app.use(configureSession());

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Set up basic route 
app.get('/', (req, res) => {
  res.send('Auth service is running');
});

// Set up session debug route
app.get('/debug/session', (req, res) => {
  res.json({
    sessionID: req.sessionID || 'No session ID',
    sessionExists: !!req.session,
    cookies: req.headers.cookie || 'No cookies',
    redisConnected: redisClient ? redisClient.isReady : 'Redis not configured'
  });
});

// Set up auth routes
app.use('/auth', initializeAuth());

// Start server
const PORT = process.env.PORT || 3000;
const startServer = async () => {
  // Connect to Redis if configured
  if (redisClient) {
    try {
      redisClient.on('error', (err) => {
        console.error('❌ Redis Error:', err);
      });
      
      await redisClient.connect();
      console.log("✅ Redis connected");
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
      console.log("⚠️ Continuing with in-memory session store");
    }
  }

  // Start the server
  app.listen(PORT, () => {
    console.log(`✅ Auth server running on port ${PORT}`);
  });
};

startServer();