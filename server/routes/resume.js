import express from 'express';
import multer from 'multer';
import { parseResumeBuffer } from '../parseResume.js';
import { supabase } from '../supabase.js';
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

// Upload endpoint - removed auth check since it's handled by middleware
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
        // Parse resume from buffer (no file system involved)
        const resumeData = await parseResumeBuffer(req.file.buffer, req.file.originalname);

        // Get user info from auth middleware (req.user is set by verifyAuthToken)
        const userId = req.user.id || req.user.email; // Adjust based on your JWT payload

        // Store in Supabase
        const { data, error } = await supabase
          .from('resumes')
          .insert({
            user_id: userId,
            filename: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            parsed_data: resumeData,
            uploaded_at: new Date().toISOString()
          });

        if (error) {
          console.error('Supabase error:', error);
          return res.status(500).json({ error: 'Failed to save resume data' });
        }

        res.json({
          success: true,
          message: 'Resume uploaded and parsed successfully',
          data: resumeData
        });

      } catch (parseError) {
        console.error('Parse error:', parseError);
        res.status(500).json({ error: 'Failed to parse resume' });
      }
    });

  } catch (error) {
    console.error('Upload handler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Define routes - NOW using verifyAuthToken as middleware
router.post('/upload', verifyAuthToken, uploadResume);

// Export the router as default
export default router;
