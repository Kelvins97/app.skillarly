// Test script to verify LinkedIn OAuth credentials
// Save as verify-linkedin-credentials.js

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';

// Load environment variables
dotenv.config();

// Function to validate LinkedIn credentials format
const validateCredentialsFormat = () => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_CALLBACK_URL;
  
  console.log('\n=== CREDENTIAL FORMAT CHECK ===');
  
  if (!clientId) {
    console.error('❌ LINKEDIN_CLIENT_ID is missing');
    return false;
  }
  
  if (!clientSecret) {
    console.error('❌ LINKEDIN_CLIENT_SECRET is missing');
    return false;
  }
  
  if (!redirectUri) {
    console.error('❌ LINKEDIN_CALLBACK_URL is missing');
    return false;
  }

  // LinkedIn client IDs are typically alphanumeric and around 12 characters
  if (!/^[a-z0-9]{10,14}$/i.test(clientId)) {
    console.warn('⚠️ LINKEDIN_CLIENT_ID format looks unusual. Expected format: alphanumeric, 10-14 characters');
    console.log(`   Current value: ${clientId}`);
  } else {
    console.log('✅ LINKEDIN_CLIENT_ID format looks valid');
  }
  
  // LinkedIn client secrets don't typically contain special characters like = or dots
  if (clientSecret.includes('==') || clientSecret.includes('.')) {
    console.warn('⚠️ LINKEDIN_CLIENT_SECRET format looks unusual (contains == or . characters)');
    console.log('   This may indicate the secret was incorrectly copied or encoded');
  } else {
    console.log('✅ LINKEDIN_CLIENT_SECRET format appears normal');
  }
  
  // Check if redirect URI is properly formatted
  try {
    const url = new URL(redirectUri);
    console.log('✅ LINKEDIN_CALLBACK_URL is a valid URL');
    console.log(`   Protocol: ${url.protocol}, Host: ${url.hostname}, Path: ${url.pathname}`);
  } catch (e) {
    console.error('❌ LINKEDIN_CALLBACK_URL is not a valid URL:', redirectUri);
    return false;
  }
  
  return true;
};

// Function to test LinkedIn's token endpoint
const testTokenEndpoint = async () => {
  console.log('\n=== LINKEDIN API CONNECTION TEST ===');
  
  try {
    // We're not sending a valid code, just testing if we can reach the endpoint
    // and if the error response is what we expect for invalid parameters
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'invalid_test_code',
      redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET
    });
    
    console.log('Sending test request to LinkedIn token endpoint...');
    
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    
    const data = await response.json();
    
    console.log(`Response status: ${response.status}`);
    console.log('Response body:', data);
    
    // If we get an "invalid_grant" error instead of "invalid_client", 
    // that's actually good - it means our client credentials were accepted
    if (data.error === 'invalid_grant') {
      console.log('✅ GOOD NEWS! Your client credentials are valid!');
      console.log('   The "invalid_grant" error is expected because we used a fake code.');
      return true;
    } else if (data.error === 'invalid_client') {
      console.error('❌ Client authentication failed. Your LinkedIn client ID or secret is incorrect.');
      return false;
    } else {
      console.warn('⚠️ Unexpected error:', data.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Connection error:', error.message);
    return false;
  }
};

// Main function
const main = async () => {
  console.log('=== LINKEDIN CREDENTIALS VERIFICATION TOOL ===');
  
  const formatValid = validateCredentialsFormat();
  if (!formatValid) {
    console.log('\n⚠️ There are issues with your credential format. Please fix them before proceeding.');
  }
  
  const endpointTest = await testTokenEndpoint();
  
  console.log('\n=== VERIFICATION RESULTS ===');
  if (endpointTest) {
    console.log('✅ LinkedIn credentials verification PASSED!');
    console.log('   Your client ID and secret are working correctly.');
  } else {
    console.log('❌ LinkedIn credentials verification FAILED!');
    console.log('\nPossible solutions:');
    console.log('1. Double-check your client ID and secret in the LinkedIn Developer Console');
    console.log('2. Ensure your OAuth 2.0 settings in LinkedIn include the exact redirect URI');
    console.log('3. Check if your LinkedIn app is in Development mode and your test user is authorized');
    console.log('4. Verify that your app has the correct API permissions');
  }
};

// Run the verification
main().catch(console.error);