import express from 'express';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Railway FFmpeg Service Running',
    version: '1.0.0',
    endpoints: ['/clip']
  });
});

// Clip endpoint
app.post('/clip', async (req, res) => {
  const tempDir = path.join(__dirname, 'temp');
  const inputPath = path.join(tempDir, `input-${Date.now()}.mp4`);
  const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);

  try {
    const { vodUrl, startTime, endTime } = req.body;

    if (!vodUrl || !startTime || !endTime) {
      return res.status(400).json({ 
        error: 'Missing required fields: vodUrl, startTime, endTime' 
      });
    }

    console.log('Clip request:', { vodUrl, startTime, endTime });

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Download VOD to temp file
    console.log('Downloading VOD from:', vodUrl);
    const vodResponse = await fetch(vodUrl);
    
    if (!vodResponse.ok) {
      throw new Error(`Failed to download VOD: ${vodResponse.status} ${vodResponse.statusText}`);
    }

    const vodBuffer = await vodResponse.arrayBuffer();
    await fs.writeFile(inputPath, Buffer.from(vodBuffer));
    console.log('VOD downloaded, size:', vodBuffer.byteLength, 'bytes');

    // Run FFmpeg to trim video
    console.log('Running FFmpeg trim:', { startTime, endTime });
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(calculateDuration(startTime, endTime))
        .outputOptions([
          '-c copy',           // Copy codec (fast, no re-encoding)
          '-avoid_negative_ts make_zero'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('FFmpeg command:', cmd);
        })
        .on('progress', (progress) => {
          console.log('Processing:', progress.percent ? `${progress.percent.toFixed(2)}%` : 'in progress');
        })
        .on('end', () => {
          console.log('FFmpeg processing complete');
          resolve(true);
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .run();
    });

    // Read output file
    const outputBuffer = await fs.readFile(outputPath);
    console.log('Output file size:', outputBuffer.length, 'bytes');

    if (outputBuffer.length === 0) {
      throw new Error('FFmpeg produced empty output file');
    }

    // Clean up temp files
    await fs.unlink(inputPath).catch(err => console.warn('Failed to delete input:', err));
    await fs.unlink(outputPath).catch(err => console.warn('Failed to delete output:', err));

    // Send MP4 back to client
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="clip.mp4"',
      'Content-Length': outputBuffer.length
    });
    res.send(outputBuffer);

  } catch (error) {
    console.error('Clip processing error:', error);
    
    // Clean up on error
    try {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    } catch (cleanupError) {
      console.warn('Cleanup error:', cleanupError);
    }

    res.status(500).json({ 
      error: 'Failed to process clip',
      message: error.message,
      type: error.constructor.name
    });
  }
});

// Helper: Calculate duration from start and end time
function calculateDuration(startTime, endTime) {
  const start = parseTimeToSeconds(startTime);
  const end = parseTimeToSeconds(endTime);
  return end - start;
}

// Helper: Convert HH:MM:SS to seconds
function parseTimeToSeconds(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else {
    return parts[0];
  }
}

app.listen(PORT, () => {
  console.log(`Railway FFmpeg Service listening on port ${PORT}`);
  console.log(`FFmpeg path: ${ffmpegStatic}`);
});
