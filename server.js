const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// In-memory storage for processed files
let processedFiles = new Map();
let resumeDatabase = [];

// Utility functions
function getFileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function isFileProcessed(filename, hash) {
  return processedFiles.has(filename) && processedFiles.get(filename) === hash;
}

function markFileAsProcessed(filename, hash) {
  processedFiles.set(filename, hash);
}

function cleanText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

function validateEmail(email) {
  if (typeof email !== 'string') return '';
  email = email.trim().toLowerCase();
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailPattern.test(email) ? email : '';
}

function cleanPhone(phone) {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return (digits.length >= 10 && digits.length <= 15) ? digits : '';
}

function cleanSkillsList(skills) {
  if (!Array.isArray(skills)) return [];
  
  const cleanedSkills = [];
  const seenSkills = new Set();
  
  for (const skill of skills) {
    if (typeof skill === 'string') {
      const cleanSkill = cleanText(skill);
      if (cleanSkill && !seenSkills.has(cleanSkill.toLowerCase())) {
        cleanedSkills.push(cleanSkill);
        seenSkills.add(cleanSkill.toLowerCase());
      }
    }
  }
  
  return cleanedSkills;
}

function validateAndCleanData(extractedData) {
  return {
    name: cleanText(extractedData.name || ''),
    email: validateEmail(extractedData.email || ''),
    phone: cleanPhone(extractedData.phone || ''),
    skills: cleanSkillsList(extractedData.skills || []),
    experience_years: cleanText(extractedData.experience_years || ''),
    education: cleanText(extractedData.education || ''),
    location: cleanText(extractedData.location || ''),
    summary: cleanText(extractedData.summary || '')
  };
}

async function smartDelay(attempt = 0) {
  const baseDelay = 8000; // 8 seconds
  const jitter = Math.random() * 3000 + 1000; // 1-4 seconds jitter
  const progressiveDelay = attempt * 5000; // 5 seconds per retry
  
  const totalDelay = baseDelay + jitter + progressiveDelay;
  await new Promise(resolve => setTimeout(resolve, totalDelay));
}

async function parseWithOpenRouter(resumeText, apiKey) {
  const prompt = `Extract key information from this resume and return as JSON:

{
    "name": "Full name",
    "email": "Email address", 
    "phone": "Phone number",
    "skills": ["skill1", "skill2"],
    "experience_years": "Years of experience",
    "education": "Highest degree",
    "location": "Location",
    "summary": "Brief summary"
}

Resume: ${resumeText.substring(0, 6000)}

JSON only:`;

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://ai-resume-parser.com',
    'X-Title': 'Resume Parser'
  };

  const payload = {
    model: 'google/gemini-2.0-flash-exp:free',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1024,
    stream: false
  };

  const maxRetries = 5;
  const exponentialBackoffBase = 15;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await smartDelay(attempt);

      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        payload,
        { headers, timeout: 90000 }
      );

      if (response.status === 200) {
        const result = response.data;
        if (result.choices && result.choices.length > 0) {
          const content = result.choices[0].message.content;
          const jsonMatch = content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
          
          if (jsonMatch) {
            try {
              const extractedData = JSON.parse(jsonMatch[0]);
              return validateAndCleanData(extractedData);
            } catch (jsonError) {
              throw new Error(`JSON decode error: ${jsonError.message}`);
            }
          } else {
            throw new Error('No valid JSON found in response');
          }
        } else {
          throw new Error('Unexpected API response structure');
        }
      } else if (response.status === 429) {
        const waitTime = exponentialBackoffBase * (2 ** attempt) + Math.random() * 5 + 1;
        console.log(`Rate limited. Waiting ${waitTime.toFixed(1)} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        continue;
      } else {
        throw new Error(`API request failed with status ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.log(`Request timeout (attempt ${attempt + 1}/${maxRetries})`);
      } else if (error.code === 'ECONNRESET') {
        console.log(`Connection error (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.error(`Error on attempt ${attempt + 1}:`, error.message);
      }
      
      if (attempt === maxRetries - 1) {
        throw error;
      }
    }
  }
}

async function parseWithGemini(resumeText, apiKey) {
  const jsonSchema = {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING', description: 'Full name of the candidate' },
      email: { type: 'STRING', description: 'Primary email address' },
      phone: { type: 'STRING', description: 'Primary phone number' },
      skills: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'List of technical and professional skills'
      },
      experience_years: { type: 'STRING', description: 'Total years of professional experience' },
      education: { type: 'STRING', description: 'Highest degree or relevant education' },
      location: { type: 'STRING', description: 'Current location or address' },
      summary: { type: 'STRING', description: 'Professional summary or objective' }
    },
    required: ['name', 'email', 'phone', 'skills']
  };

  const prompt = `Extract resume information and return as JSON:

Resume Text:
${resumeText.substring(0, 8000)}

JSON Schema:
${JSON.stringify(jsonSchema, null, 2)}

Respond with ONLY the JSON object:`;

  const payload = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: jsonSchema,
      temperature: 0.1,
      maxOutputTokens: 2048
    }
  };

  try {
    await smartDelay();

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );

    if (response.status === 200) {
      const result = response.data;
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts) {
        
        const jsonString = result.candidates[0].content.parts[0].text;
        const extractedData = JSON.parse(jsonString);
        return validateAndCleanData(extractedData);
      } else {
        throw new Error('Gemini API response missing expected content structure');
      }
    } else {
      throw new Error(`Gemini API request failed with status ${response.status}`);
    }
  } catch (error) {
    throw new Error(`Gemini parsing error: ${error.message}`);
  }
}

async function parseResumeWithAI(resumeText, apiKey) {
  if (!resumeText || !resumeText.trim()) {
    throw new Error('No resume text provided for AI parsing');
  }

  if (!apiKey) {
    throw new Error('API key is missing');
  }

  const isOpenRouter = apiKey.startsWith('sk-or-v1-');
  
  if (isOpenRouter) {
    return await parseWithOpenRouter(resumeText, apiKey);
  } else {
    return await parseWithGemini(resumeText, apiKey);
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/upload-resumes', upload.array('resumes'), async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = {
      successful: [],
      failed: [],
      newFiles: [],
      alreadyProcessed: []
    };

    // Filter new files
    for (const file of req.files) {
      const fileHash = getFileHash(file.buffer);
      
      if (isFileProcessed(file.originalname, fileHash)) {
        results.alreadyProcessed.push(file.originalname);
      } else {
        results.newFiles.push({
          originalname: file.originalname,
          buffer: file.buffer,
          hash: fileHash
        });
      }
    }

    // Process new files
    for (const file of results.newFiles) {
      try {
        // Extract text from PDF
        const pdfData = await pdfParse(file.buffer);
        const resumeText = pdfData.text;

        if (!resumeText.trim()) {
          results.failed.push({
            filename: file.originalname,
            error: 'No text extracted from PDF'
          });
          continue;
        }

        // Parse with AI
        const parsedData = await parseResumeWithAI(resumeText, apiKey);
        
        if (parsedData) {
          parsedData.filename = file.originalname;
          results.successful.push(parsedData);
          resumeDatabase.push(parsedData);
          markFileAsProcessed(file.originalname, file.hash);
        } else {
          results.failed.push({
            filename: file.originalname,
            error: 'AI parsing failed'
          });
        }
      } catch (error) {
        results.failed.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/load-excel', upload.single('excel'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Validate columns
    const expectedColumns = ['filename', 'name', 'email', 'phone', 'skills', 'experience_years', 'education'];
    const actualColumns = Object.keys(data[0] || {});
    const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));

    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: 'Missing required columns',
        missingColumns,
        expectedColumns
      });
    }

    res.json({
      data,
      recordCount: data.length,
      columns: actualColumns
    });
  } catch (error) {
    console.error('Excel load error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/export-excel', (req, res) => {
  try {
    const { data, includeExisting, existingData } = req.body;

    let finalData = data;
    
    if (includeExisting && existingData) {
      // Remove duplicates and merge
      const existingFilenames = new Set(existingData.map(item => item.filename));
      const newData = data.filter(item => !existingFilenames.has(item.filename));
      finalData = [...existingData, ...newData];
    }

    // Convert skills arrays to strings
    const processedData = finalData.map(item => ({
      ...item,
      skills: Array.isArray(item.skills) ? item.skills.join(', ') : item.skills
    }));

    const worksheet = XLSX.utils.json_to_sheet(processedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resume_Database');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=resume_database.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session-stats', (req, res) => {
  res.json({
    totalProcessedFiles: processedFiles.size,
    totalResumes: resumeDatabase.length,
    processedFiles: Array.from(processedFiles.keys()).slice(-10) // Last 10 files
  });
});

app.delete('/api/clear-session', (req, res) => {
  processedFiles.clear();
  resumeDatabase.length = 0;
  res.json({ message: 'Session data cleared' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;