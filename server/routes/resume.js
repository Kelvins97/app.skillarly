import multer from 'multer';
import { parseResume } from './parseResume.js';
import { supabase } from './supabase.js'; // service role client

const upload = multer({ dest: 'uploads/' });

app.post('/upload-resume', verifyAuthToken, upload.single('resume'), async (req, res) => {
  const email = req.user.email;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const parsedData = await parseResume(file.path);

    const { data, error } = await supabase
      .from('users')
      .update({
        parsed_resume: parsedData,
        resume_uploaded_at: new Date()
      })
      .eq('email', email);

    if (error) throw error;

    res.json({ success: true, parsed: parsedData });
  } catch (err) {
    console.error('Resume upload error:', err);
    res.status(500).json({ error: 'Failed to process resume' });
  }
});
