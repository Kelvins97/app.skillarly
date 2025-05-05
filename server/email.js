import axios from 'axios';
import { generateRecommendationEmail } from './templates/recommendationEmail.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Skillarly <onboarding@resend.dev>';

 export async function sendEmail(to, name, { primarySkill, email, courses, certifications, jobs }) {
  const html = generateRecommendationEmail({
    firstName: name,
    primarySkill,
    email,
    courses,
    certifications,
    jobs
  });

  try {
    const res = await axios.post('https://api.resend.com/emails', {
      from: FROM_EMAIL,
      to,
      subject: 'Your Skillarly Career Recommendations',
      html,
    }, {
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    console.log('📧 Email sent to', to);
  } catch (e) {
    console.error('❌ Failed to send email:', e.response?.data || e.message);
  }
}


