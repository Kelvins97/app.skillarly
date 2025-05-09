import express from 'express';
const router = express.Router();
import passport from 'passport';
//var LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
import session from 'express-session';
import LinkedInStrategy from '@sokratis/passport-linkedin-oauth2';




// Configure LinkedIn strategy
passport.use(new LinkedInStrategy({
  clientID: process.env.LINKEDIN_CLIENT_ID,
  clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  callbackURL: 'https://skillarly-backend.onrender.com/auth/linkedin/callback',
  scope: ['email', 'profile', 'openid'],
  state: true
}, (accessToken, refreshToken, profile, done) => {
  // Store the LinkedIn profile data and tokens
  return done(null, {
    id: profile.id,
    displayName: profile.displayName,
    profileUrl: profile._json.vanityName ? `https://linkedin.com/in/${profile._json.vanityName}` : null,
    accessToken: accessToken
  });
}));

// Serialize/deserialize user for sessions
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Set up Express with session support
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());


// LinkedIn OAuth routes
router.get('/auth/linkedin', passport.authenticate('linkedin'));
router.get('/auth/linkedin/callback',
  passport.authenticate('linkedin', {
    failureRedirect: '/login-failed',
    successRedirect: process.env.FRONTEND_URL
  })
);

// Authentication routes
app.get('/auth/linkedin', passport.authenticate('linkedin'));

app.get('/auth/linkedin/callback', 
  passport.authenticate('linkedin', { 
    failureRedirect: '/login-failed' 
  }),
  (req, res) => {
    // Successful authentication
    // Store the profile URL from LinkedIn
    const profileUrl = req.user.profileUrl;
    
    // Redirect to the analysis page with secure token
    res.redirect(`https://skillarly.vercel.app/dashboard?profile=${encodeURIComponent(profileUrl)}&token=${generateSecureToken(req.user)}`);
  }
);

// Middleware to check if the user is authenticated and owns the profile
function checkProfileOwnership(req, res, next) {
  // If not authenticated, redirect to login
  if (!req.isAuthenticated()) {
    return res.redirect('https://skillarly-backend.onrender.com/auth/linkedin');
  }
  
  // Get requested profile from URL parameters
  const requestedProfile = req.query.profile;
  
  // Compare with authenticated user's profile
  if (req.user.profileUrl && requestedProfile === req.user.profileUrl) {
    // User owns this profile, proceed
    return next();
  } else {
    // Not authorized to view this profile
    return res.status(403).send('You can only analyze your own LinkedIn profile');
  }
}

// Protected route that only profile owners can access
app.post('/scrape-profile', checkProfileOwnership, async (req, res) => {
  // Scrape the profile - this is now safe because we've verified ownership
  // Use the LinkedIn API with the user's access token for proper access
  try {
    // Your profile scraping logic here
    // Use req.user.accessToken for authenticated API calls
    
    res.status(200).json({ success: true, message: 'Profile scraped successfully' });
  } catch (error) {
    console.error('Error scraping profile:', error);
    res.status(500).json({ success: false, message: 'Error scraping profile' });
  }
});

// Function to generate a secure token for the user
function generateSecureToken(user) {
  // Implementation depends on your preferred method (JWT, etc.)
  // This is just a placeholder
  return Buffer.from(JSON.stringify({
    id: user.id,
    timestamp: Date.now()
  })).toString('base64');
}



// Export the router
module.exports = router; // 🟢 Critical!
