import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

export async function parseResumeBuffer(buffer) {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid or empty buffer provided');
    }

    console.log(`Processing PDF buffer of size: ${buffer.length} bytes`);
    
    const typedarray = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
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
