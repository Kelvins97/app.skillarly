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

// Configure CORS with correct credentials settings
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://skillarly-app.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON request bodies
app.use(express.json());

// Initialize Redis client
let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    redisClient = createClient({ 
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Too many Redis reconnection attempts, giving up');
            return new Error('Too many Redis reconnection attempts');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });
    
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    console.log('Redis client initialized with URL');
  } catch (error) {
    console.error('Failed to initialize Redis client:', error);
    redisClient = null;
  }
}

// Configure session middleware
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
      httpOnly: true,
      path: '/'
    },
    proxy: process.env.NODE_ENV === 'production' // Important if behind a proxy like Vercel
  };

  // Use Redis store if Redis is configured
  if (redisClient) {
    try {
      sessionOptions.store = new RedisStore({ client: redisClient });
      console.log('Using Redis session store');
    } catch (error) {
      console.error('Failed to create Redis store:', error);
      console.warn('⚠️ Falling back to in-memory session store');
    }
  } else {
    console.warn('⚠️ No Redis URL provided or connection failed - using in-memory session store');
    // In-memory store will be used automatically
  }

  return session(sessionOptions);
};

// Initialize session - wait until right before starting the server to connect to Redis
const initializeSessionMiddleware = async () => {
  // If Redis is configured, try to connect
  if (redisClient) {
    try {
      await redisClient.connect();
      console.log("✅ Redis connected successfully");
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
      console.log("⚠️ Continuing with in-memory session store");
      redisClient = null;
    }
  }
  
  // Now set up session middleware
  const sessionMiddleware = configureSession();
  app.use(sessionMiddleware);
  
  // Initialize Passport
  app.use(passport.initialize());
  app.use(passport.session());
  
  console.log("✅ Session middleware initialized");
};

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

// Start server
const PORT = process.env.PORT || 3000;
const startServer = async () => {
  try {
    // Initialize session middleware (connects to Redis if configured)
    await initializeSessionMiddleware();
    
    // Set up auth routes after session middleware is initialized
    app.use('/auth', initializeAuth());
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`✅ Auth server running on port ${PORT}`);
      console.log(`✅ CORS enabled for origin: ${process.env.FRONTEND_URL || 'https://skillarly-app.vercel.app'}`);
      console.log(`✅ Session store type: ${redisClient?.isReady ? 'Redis' : 'In-memory'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Add error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();
