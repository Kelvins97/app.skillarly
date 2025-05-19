// cleaned-up linkedin.js
import express from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const router = express.Router();

const generateSecureToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24h
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

router.get('/linkedin', (req, res) => {
  const state = Math.random().toString(36).substring(2);

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', process.env.LINKEDIN_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
  authUrl.searchParams.append('scope', 'r_liteprofile r_emailaddress');
  authUrl.searchParams.append('state', state);

  res.redirect(authUrl.toString());
});

router.get('/linkedin/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      })
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('No access token');

    // Fetch user profile
    const profileRes = await fetch('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const profile = await profileRes.json();

    // Fetch user email
    const emailRes = await fetch('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const emailData = await emailRes.json();
    const email = emailData?.elements?.[0]?.['handle~']?.emailAddress;

    if (!email) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=email_missing`);
    }

    const user = {
      id: profile.id,
      name: `${profile.localizedFirstName || ''} ${profile.localizedLastName || ''}`.trim(),
      email
    };

    const token = generateSecureToken(user);
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(token)}`;
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('LinkedIn OAuth error:', err);
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
});

export default router;
