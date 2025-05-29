import express from 'express';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from '@sokratis/passport-linkedin-oauth2';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const router = express.Router();

const generateSecureToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24)
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

router.get('/linkedin/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);

    const tokenRequest = new URLSearchParams();
    tokenRequest.append('grant_type', 'authorization_code');
    tokenRequest.append('code', code);
    tokenRequest.append('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
    tokenRequest.append('client_id', process.env.LINKEDIN_CLIENT_ID);
    tokenRequest.append('client_secret', process.env.LINKEDIN_CLIENT_SECRET);

    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequest.toString()
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    const userInfo = await profileResponse.json();
    const userEmail = userInfo.email || `user-${Date.now()}@linkedin.local`;
    const userName = userInfo.name || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim() || 'LinkedIn User';

    let userId;
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', userEmail)
      .single();

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert([{
          email: userEmail,
          name: userName,
          joined_at: new Date().toISOString(),
          plan: 'basic',
          subscribed: true,
          email_notifications: true
        }])
        .select('id')
        .single();

      if (insertErr) {
        console.error('Failed to insert user into Supabase:', insertErr);
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=user_creation_failed`);
      }
      userId = newUser.id;
    }

    const jwtToken = generateSecureToken({
      id: userId,
      name: userName,
      email: userEmail
    });

    return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(jwtToken)}`);

  } catch (err) {
    console.error('LinkedIn login error:', err);
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
  }
});

export default router;
