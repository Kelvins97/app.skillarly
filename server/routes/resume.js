import express from 'express';
import multer from 'multer';
import { parseResumeBuffer } from '../parseResume.js';
import { supabase } from '../supabase.js'; // This should be your admin client
import path from 'path';
import { verifyAuthToken } from '../authMiddleware.js';

const router = express.Router();

// Configure multer with memory storage instead of disk storage
const storage = multer.memoryStorage();

// Configure multer with file validation
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF and DOC/DOCX files
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'), false);
    }
  }
});

// Upload endpoint - fixed to match current schema
const uploadResume = async (req, res) => {
  try {
    // Handle file upload
    upload.single('resume')(req, res, async (err) => {
      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ error: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      try {
        console.log(`✅ Authenticated as: ${req.user.email}`);
        console.log(`Processing ${req.file.originalname} buffer of size: ${req.file.size} bytes`);

        // Parse resume from buffer (no file system involved)
        const resumeData = await parseResumeBuffer(req.file.buffer, req.file.originalname);

        // Get user email from auth middleware
        const userEmail = req.user.email;

        if (!userEmail) {
          return res.status(401).json({ error: 'User email not found in token' });
        }

        // First, get user ID for potential future use and validation
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id, email')
          .eq('email', userEmail)
          .single();

        if (userError || !user) {
          console.error('User not found:', userError);
          return res.status(404).json({ error: 'User not found in database' });
        }

        console.log(`Found user ID: ${user.id} for email: ${userEmail}`);

        // Store in Supabase using admin client to bypass RLS
        const { data, error } = await supabase
          .from('resumes')
          .insert({
            user_email: userEmail,  // ✅ Use email as FK (current schema)
            filename: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            parsed_data: resumeData,
            uploaded_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('❌ Supabase insert error:', error);
          return res.status(500).json({ 
            error: 'Failed to save resume data',
            details: error.message 
          });
        }

        console.log(`✅ Resume saved with ID: ${data.id}`);

        // Optional: Update users table with latest resume info using admin client
        const { error: updateError } = await supabase
          .from('users')
          .update({
            resume_uploaded_at: new Date().toISOString(),
            parsed_resume: resumeData,
            // Update profile fields from resume if they exist
            skills: resumeData.skills || null,
            certifications: resumeData.certifications || null,
            education: resumeData.education || null,
            companies: resumeData.companies || null
          })
          .eq('email', userEmail);

        if (updateError) {
          console.warn('⚠️ Failed to update user profile:', updateError.message);
          // Don't fail the request, just log the warning
        }

        res.json({
          success: true,
          message: 'Resume uploaded and parsed successfully',
          resume_id: data.id,
          user_id: user.id,
          data: resumeData
        });

      } catch (parseError) {
        console.error('❌ Parse error:', parseError);
        res.status(500).json({ 
          error: 'Failed to parse resume',
          details: parseError.message 
        });
      }
    });

  } catch (error) {
    console.error('❌ Upload handler error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
};

// Health check endpoint for testing
const healthCheck = async (req, res) => {
  res.json({
    success: true,
    message: 'Resume upload service is running',
    user: req.user ? {
      email: req.user.email,
      id: req.user.id
    } : null
  });
};

// Define routes - using verifyAuthToken as middleware
router.post('/', verifyAuthToken, uploadResume);
router.get('/health', verifyAuthToken, healthCheck);

// Export the router as default
export default router;
