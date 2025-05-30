import axios from 'axios';
import { generateRecommendationEmail } from './templates/recommendationEmail.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Skillarly <onboarding@resend.dev>';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Validate environment variables
if (!RESEND_API_KEY) {
  console.error('🚨 RESEND_API_KEY environment variable is required');
  process.exit(1);
}

/**
 * Send recommendation email with retry logic
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient name
 * @param {Object} data - Email data object
 * @param {string} data.primarySkill - User's primary skill
 * @param {string} data.email - User's email
 * @param {Array} data.courses - Recommended courses
 * @param {Array} data.certifications - Recommended certifications
 * @param {Array} data.jobs - Recommended jobs
 * @returns {Promise<Object>} - Email response or throws error
 */
export async function sendEmail(to, name, { primarySkill, email, courses, certifications, jobs }) {
  // Input validation
  if (!to || !isValidEmail(to)) {
    throw new Error(`Invalid recipient email: ${to}`);
  }

  if (!courses || !certifications || !jobs) {
    throw new Error('Missing required recommendation data');
  }

  const emailData = {
    firstName: name || 'User',
    primarySkill: primarySkill || 'Software Development',
    email: email || to,
    courses: Array.isArray(courses) ? courses : [],
    certifications: Array.isArray(certifications) ? certifications : [],
    jobs: Array.isArray(jobs) ? jobs : []
  };

  console.log(`📤 Preparing to send email to ${to} with ${courses.length} courses, ${certifications.length} certifications, ${jobs.length} jobs`);

  const html = generateRecommendationEmail(emailData);

  const payload = {
    from: FROM_EMAIL,
    to: [to], // Resend expects an array
    subject: `Your Skillarly Career Recommendations - ${primarySkill}`,
    html,
  };

  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`📧 Sending email attempt ${attempt}/${MAX_RETRIES} to ${to}`);
      
      const response = await axios.post('https://api.resend.com/emails', payload, {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      });

      console.log(`✅ Email sent successfully to ${to} (ID: ${response.data.id})`);
      
      return {
        success: true,
        messageId: response.data.id,
        recipient: to,
        attempt: attempt
      };

    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Email attempt ${attempt}/${MAX_RETRIES} failed for ${to}:`, 
        error.response?.data?.message || error.message);

      // Don't retry on certain errors
      if (error.response?.status === 400 || error.response?.status === 401) {
        console.error(`🚨 Non-retryable error for ${to}:`, error.response.data);
        break;
      }

      // Wait before retrying (except on last attempt)
      if (attempt < MAX_RETRIES) {
        console.log(`⏳ Waiting ${RETRY_DELAY}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  // If we get here, all attempts failed
  const errorMessage = lastError.response?.data?.message || lastError.message;
  console.error(`❌ All email attempts failed for ${to}:`, errorMessage);
  
  throw new Error(`Failed to send email to ${to} after ${MAX_RETRIES} attempts: ${errorMessage}`);
}

/**
 * Send bulk recommendation emails with rate limiting
 * @param {Array} emailList - Array of email objects
 * @param {number} delayMs - Delay between emails in milliseconds
 * @returns {Promise<Object>} - Summary of results
 */
export async function sendBulkEmails(emailList, delayMs = 500) {
  const results = {
    total: emailList.length,
    successful: 0,
    failed: 0,
    errors: []
  };

  console.log(`📮 Starting bulk email send for ${emailList.length} recipients`);

  for (let i = 0; i < emailList.length; i++) {
    const emailData = emailList[i];
    
    try {
      await sendEmail(emailData.to, emailData.name, emailData.data);
      results.successful++;
      console.log(`📊 Progress: ${i + 1}/${emailList.length} (${results.successful} successful, ${results.failed} failed)`);
    } catch (error) {
      results.failed++;
      results.errors.push({
        recipient: emailData.to,
        error: error.message
      });
      console.error(`❌ Failed to send to ${emailData.to}:`, error.message);
    }

    // Rate limiting - don't overwhelm the API
    if (i < emailList.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`🎯 Bulk email completed: ${results.successful}/${results.total} successful`);
  return results;
}

/**
 * Send a test email to verify configuration
 * @param {string} testEmail - Email address to send test to
 * @returns {Promise<boolean>} - Success status
 */
export async function sendTestEmail(testEmail) {
  try {
    const testData = {
      primarySkill: 'JavaScript',
      email: testEmail,
      courses: ['Test Course 1', 'Test Course 2', 'Test Course 3'],
      certifications: ['Test Certification 1', 'Test Certification 2'],
      jobs: ['Test Job 1', 'Test Job 2']
    };

    await sendEmail(testEmail, 'Test User', testData);
    console.log(`✅ Test email sent successfully to ${testEmail}`);
    return true;
  } catch (error) {
    console.error(`❌ Test email failed:`, error.message);
    return false;
  }
}

/**
 * Simple email validation
 * @param {string} email - Email to validate
 * @returns {boolean} - Is valid email
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Get email service health status
 * @returns {Object} - Service status
 */
export function getEmailServiceStatus() {
  return {
    configured: !!RESEND_API_KEY,
    fromEmail: FROM_EMAIL,
    maxRetries: MAX_RETRIES,
    retryDelay: RETRY_DELAY
  };
}

// Export constants for testing
export { MAX_RETRIES, RETRY_DELAY };
