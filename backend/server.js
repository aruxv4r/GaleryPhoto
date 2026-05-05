require('dotenv').config();
const express = require('express');
const Busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || `http://127.0.0.1:${PORT}`;
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'credentials.json');
const OAUTH_CREDENTIALS_PATH = path.join(__dirname, 'oauth_credentials.json');
const OAUTH_TOKEN_PATH = path.join(__dirname, 'oauth_token.json');
const DB_PATH = path.join(__dirname, 'db.json');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const USE_SUPABASE = Boolean(supabase);
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/quicktime',
  'video/webm',
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.webm'];

const app = express();

app.use((req, res, next) => {
  console.log('[API] incoming', req.method, req.url);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

let oauth2Client = null;

function createOAuthClient() {
  if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    throw new Error('OAuth credentials file not found. Create oauth_credentials.json.');
  }

  const content = fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8');
  const credentials = JSON.parse(content);
  const client = credentials.installed || credentials.web;

  if (!client) {
    throw new Error('Invalid OAuth credentials format. Use OAuth client JSON from Google Cloud.');
  }

  oauth2Client = new google.auth.OAuth2(
    client.client_id,
    client.client_secret,
    client.redirect_uris[0]
  );
}

async function loadStoredToken() {
  if (!fs.existsSync(OAUTH_TOKEN_PATH)) return null;
  const tokenData = await fs.promises.readFile(OAUTH_TOKEN_PATH, 'utf8');
  return JSON.parse(tokenData);
}

async function saveToken(tokens) {
  await fs.promises.writeFile(OAUTH_TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

async function authorizeOAuth() {
  if (!oauth2Client) {
    createOAuthClient();
  }

  const tokens = await loadStoredToken();
  if (!tokens) {
    return false;
  }

  oauth2Client.setCredentials(tokens);
  return true;
}

async function getDriveClient() {
  if (!oauth2Client) {
    createOAuthClient();
  }

  const authorized = await authorizeOAuth();
  if (!authorized) {
    throw new Error('Google OAuth not authorized. Call /auth and complete authorization first.');
  }

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function readDatabaseFromFile() {
  try {
    const content = await fs.promises.readFile(DB_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
      return [];
    }
    throw error;
  }
}

async function writeDatabaseToFile(records) {
  await fs.promises.writeFile(DB_PATH, JSON.stringify(records, null, 2), 'utf8');
}

async function readDatabase() {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from('images')
      .select('*')
      .order('uploadDate', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }

  return readDatabaseFromFile();
}

async function saveImageRecord(record) {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from('images')
      .insert([record])
      .select();

    if (error) {
      throw error;
    }

    return data?.[0] || record;
  }

  const db = await readDatabaseFromFile();
  db.push(record);
  await writeDatabaseToFile(db);
  return record;
}

async function uploadToGoogleDrive(stream, fileName, mimeType) {
  const driveClient = await getDriveClient();
  const response = await driveClient.files.create({
    requestBody: {
      name: fileName,
      parents: [FOLDER_ID],
      mimeType,
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id,webViewLink,webContentLink',
    supportsAllDrives: true,
  });

  return response.data;
}

async function makeFilePublic(fileId) {
  const driveClient = await getDriveClient();
  await driveClient.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true,
  });
}

function buildPublicUrl(fileId) {
  return `${BACKEND_BASE_URL}/image/${fileId}`;
}

function buildDriveDirectUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

function getFileIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const queryMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];
  const driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return driveMatch[1];
  const proxyMatch = url.match(/\/image\/([a-zA-Z0-9_-]+)/);
  if (proxyMatch) return proxyMatch[1];
  return null;
}

async function driveFileExists(fileId) {
  if (!fileId) return false;
  try {
    const driveClient = await getDriveClient();
    await driveClient.files.get({ fileId, fields: 'id' });
    return true;
  } catch (error) {
    if (
      error.code === 404 ||
      error.response?.status === 404 ||
      error.errors?.[0]?.reason === 'notFound' ||
      /file not found/i.test(error.message)
    ) {
      return false;
    }
    if (error.message && /auth|invalid credentials|not authorized/i.test(error.message)) {
      console.warn('Unable to verify Drive file existence due auth:', error.message);
      return null;
    }
    throw error;
  }
}

function normalizeImageUrl(record) {
  const fileId = record.fileId && record.fileId !== 'undefined'
    ? record.fileId
    : getFileIdFromUrl(record.url);

  if (fileId) {
    return FOLDER_ID ? buildPublicUrl(fileId) : buildDriveDirectUrl(fileId);
  }

  if (record.url && typeof record.url === 'string') {
    if (record.url.includes('undefined')) {
      return null;
    }
    return record.url;
  }

  return null;
}

function validateFile(fileName, mimeType) {
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(mimeType) || !ALLOWED_EXTENSIONS.includes(extension)) {
    const error = new Error('Invalid file type. Only JPG, PNG, MP4, MOV, and WEBM are allowed.');
    error.status = 400;
    throw error;
  }
}

app.post('/upload', async (req, res) => {
  if (!FOLDER_ID) {
    return res.status(503).json({ success: false, message: 'Upload disabled: GOOGLE_DRIVE_FOLDER_ID is not configured.' });
  }

  const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_FILE_SIZE } });
  let fileReceived = false;

  try {
    await authorizeOAuth();
  } catch (authError) {
    return res.status(500).json({ success: false, message: authError.message });
  }

  try {
    const uploadResult = await new Promise((resolve, reject) => {
      busboy.on('file', async (fieldname, file, info) => {
        const { filename, encoding, mimeType } = info;
        fileReceived = true;

        if (fieldname !== 'image') {
          file.resume();
          return reject({ status: 400, message: 'Field name must be image.' });
        }

        try {
          validateFile(filename, mimeType);

          file.on('limit', () => {
            reject({ status: 413, message: 'File size exceeds the 100MB limit.' });
          });

          const uploadedFile = await uploadToGoogleDrive(file, filename, mimeType);
          await makeFilePublic(uploadedFile.id);

          resolve({
            fileId: uploadedFile.id,
            fileName: filename,
          });
        } catch (uploadError) {
          file.resume();
          reject(uploadError);
        }
      });

      busboy.on('filesLimit', () => reject({ status: 400, message: 'Only a single file upload is allowed.' }));
      busboy.on('error', (error) => reject(error));
      busboy.on('finish', () => {
        if (!fileReceived) {
          reject({ status: 400, message: 'No image file was uploaded.' });
        }
      });

      req.pipe(busboy);
    });

    const { fileId, fileName } = uploadResult;
    const url = buildPublicUrl(fileId);
    const record = {
      fileId,
      fileName,
      url,
      uploadDate: new Date().toISOString(),
    };

    await saveImageRecord(record);

    return res.json({ success: true, fileId, url });
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Upload failed.';
    return res.status(status).json({ success: false, message });
  }
});

app.get('/auth', (req, res) => {
  try {
    if (!oauth2Client) {
      createOAuthClient();
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    return res.json({ success: true, url: authUrl });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  try {
    if (!oauth2Client) {
      createOAuthClient();
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await saveToken(tokens);
    return res.send('Authorization successful. You can close this window and retry uploading.');
  } catch (error) {
    console.error('OAuth callback failed:', error);
    return res.status(500).send('Authorization failed. Check server logs for details.');
  }
});

app.get('/images', async (req, res) => {
  try {
    const records = await readDatabase();
    const seen = new Set();
    const images = [];
    const validRecords = [];

    for (const record of records) {
      const normalizedUrl = normalizeImageUrl(record);
      if (!normalizedUrl || normalizedUrl.includes('undefined')) continue;

      const fileId = record.fileId || getFileIdFromUrl(record.url);
      if (fileId) {
        const exists = await driveFileExists(fileId);
        if (exists === false) {
          continue;
        }
      }

      const key = fileId || normalizedUrl;
      if (seen.has(key)) continue;
      seen.add(key);

      validRecords.push({
        ...record,
        url: normalizedUrl,
      });
    }

    if (!USE_SUPABASE && validRecords.length !== records.length) {
      const filtered = validRecords.map(item => ({
        fileId: item.fileId,
        fileName: item.fileName,
        url: item.url,
        uploadDate: item.uploadDate,
      }));
      await writeDatabaseToFile(filtered);
    }

    return res.json({ success: true, images: validRecords });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to read image list.' });
  }
});

app.get('/image/:fileId', async (req, res) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(400).json({ success: false, message: 'Missing file ID.' });
  }

  try {
    const driveClient = await getDriveClient();
    const metadata = await driveClient.files.get({
      fileId,
      fields: 'mimeType',
    });

    const download = await driveClient.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', metadata.data.mimeType || 'application/octet-stream');
    download.data.pipe(res);
  } catch (error) {
    console.error('Image proxy failed:', error.message || error);
    res.status(500).json({ success: false, message: 'Unable to load image.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

const requireDriveUpload = !FOLDER_ID;
if (requireDriveUpload) {
  console.warn('Warning: GOOGLE_DRIVE_FOLDER_ID is not set. Uploads will be disabled, but existing image records can still be served.');
}

app.listen(PORT, () => {
  console.log(`Image upload backend running on http://localhost:${PORT}`);
  if (requireDriveUpload) {
    console.log('Upload route is disabled until GOOGLE_DRIVE_FOLDER_ID is configured.');
  }
});
