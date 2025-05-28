import { fromBuffer } from 'pdf2pic';
import Tesseract from 'tesseract.js';

export async function parseResumeBuffer(buffer) {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid or empty buffer provided');
    }

    console.log(`Processing PDF buffer of size: ${buffer.length} bytes`);
    
    // Convert PDF to images
    const convert = fromBuffer(buffer, {
      density: 200,
      saveFilename: "untitled",
      savePath: "/tmp",
      format: "png",
      width: 2000,
      height: 2000
    });

    const results = await convert.bulk(-1);
    let fullText = '';

    // OCR each page
    for (const result of results) {
      const { data: { text } } = await Tesseract.recognize(result.buffer, 'eng');
      fullText += text + '\n';
    }

    if (!fullText || fullText.trim().length === 0) {
      throw new Error('No text content found in PDF');
    }

    console.log(`Extracted text length: ${fullText.length} characters`);

    const result = {
      name: extractName(fullText),
      email: extractEmail(fullText),
      phone: extractPhone(fullText),
      skills: extractSkills(fullText),
      certifications: extractCertifications(fullText),
      experience: extractExperience(fullText),
      education: extractEducation(fullText),
      raw: fullText.substring(0, 500) + (fullText.length > 500 ? '...' : '')
    };

    console.log('Parsing completed successfully');
    return result;

  } catch (error) {
    console.error('Error in parseResumeBuffer:', error);
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}
