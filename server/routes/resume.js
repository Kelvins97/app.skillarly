import multer from 'multer';
import { parseResumeBuffer } from '../parseResume.js';
import { supabase } from '../supabase.js';
import fs from 'fs';
import path from 'path';
import { verifyAuthToken } from './authMiddleware.js';

// Ensure uploads directory exists
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer with file validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only PDF, DOC, and DOCX files
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Upload resume endpoint
app.post('/upload-resume', verifyAuthToken, upload.single('resume'), async (req, res) => {
  const email = req.user.email;
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ 
      success: false, 
      error: 'No file uploaded' 
    });
  }

  console.log('File uploaded:', {
    filename: file.filename,
    path: file.path,
    size: file.size,
    mimetype: file.mimetype
  });

  try {
    // Check if file exists at the expected path
    if (!fs.existsSync(file.path)) {
      throw new Error(`Uploaded file not found at path: ${file.path}`);
    }

    // Parse the resume
    console.log('Starting to parse resume at path:', file.path);
    const parsedData = await parseResume(file.path);
    console.log('Resume parsed successfully');

    // Store parsed data in database
    const { data, error } = await supabase
      .from('users')
      .update({
        parsed_resume: parsedData,
        resume_filename: file.originalname,
        resume_uploaded_at: new Date().toISOString()
      })
      .eq('email', email)
      .select();

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    console.log('Resume data saved to database');

    // Optionally, upload to cloud storage here and get URL
    // const resumeUrl = await uploadToCloudStorage(file.path);
    
    res.json({ 
      success: true, 
      parsed: parsedData,
      message: 'Resume uploaded and parsed successfully'
      // resumeUrl: resumeUrl // Include if using cloud storage
    });

  } catch (err) {
    console.error('Resume upload error:', err);
    
    // Clean up file if it still exists
    try {
      if (file && file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up file:', cleanupError);
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process resume',
      details: err.message 
    });
  }
});

export default router;
