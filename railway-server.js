import express from 'express';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { exec } from 'child_process';
import { promisify } from 'util';
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
    version: '2.0.0',
    endpoints: ['/clip'],
    ffmpegPath: ffmpegStatic,
  });
});

// Helper: Convert HH:MM:SS, MM:SS, or seconds to seconds - NEVER returns NaN
function parseTimeToSeconds(time) {
  // If already a number, validate and return it
  if (typeof time === 'number') {
    if (!Number.isFinite(time) || time < 0) {
      console.error('Railway: invalid numeric time value:', time);
      return 0;
    }
    return Math.floor(time);
  }

  const str = String(time);

  // Check if it's in HH:MM:SS or MM:SS format
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);

    if (parts.length === 3) {
      // HH:MM:SS
      const hours = parts[0];
      const minutes = parts[1];
      const seconds = parts[2];

      if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        console.error('Railway: invalid time format (NaN in parts):', str);
        return 0;
      }

      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      // MM:SS
      const minutes = parts[0];
      const seconds = parts[1];

      if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
        console.error('Railway: invalid time format (NaN in parts):', str);
        return 0;
      }

      return minutes * 60 + seconds;
    }
  }

  // Otherwise try to parse as number
  const parsed = Number(str);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    console.error('Railway: could not parse time value:', str);
    return 0;
  }

  return Math.floor(parsed);
}

// Clip endpoint
app.post('/clip', async (req, res) => {
  const tempDir = path.join(__dirname, 'temp');
  const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);

  try {
    const { vodUrl, startTime, endTime } = req.body;

    console.log('Railway: received clip request', { vodUrl, startTime, endTime });

    // Validate input
    if (!vodUrl || startTime == null || endTime == null) {
      console.error('Railway: missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: vodUrl, startTime, endTime',
      });
    }

    // Validate vodUrl is absolute
    if (typeof vodUrl !== 'string' || (!vodUrl.startsWith('http://') && !vodUrl.startsWith('https://'))) {
      console.error('Railway: invalid vodUrl (not absolute):', vodUrl);
      return res.status(400).json({
        error: 'vodUrl must be an absolute URL starting with http:// or https://',
        received: vodUrl,
      });
    }

    console.log('Railway: validated absolute vodUrl:', vodUrl);

    // CRITICAL: Validate m3u8 playlist URL
    if (vodUrl.includes('/rewrite-m3u8?url=')) {
      console.log('Railway: detected rewrite-m3u8 proxy URL');
      const encodedOriginal = vodUrl.split('/rewrite-m3u8?url=')[1];
      if (encodedOriginal) {
        const decodedOriginal = decodeURIComponent(encodedOriginal);
        console.log('Railway: original m3u8 URL:', decodedOriginal);
      }
    }

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Convert times to seconds - GUARANTEED to never be NaN
    const startSeconds = parseTimeToSeconds(startTime);
    const endSeconds = parseTimeToSeconds(endTime);
    
    console.log('Railway: parsed times to seconds', { startSeconds, endSeconds });

    // Validate time range
    if (endSeconds <= startSeconds) {
      console.error('Railway: invalid time range', { startSeconds, endSeconds });
      return res.status(400).json({
        error: 'Invalid time range: endTime must be greater than startTime',
        startTime,
        endTime,
        startSeconds,
        endSeconds,
      });
    }

    // Calculate duration with minimum 1 second
    const duration = Math.max(1, endSeconds - startSeconds);

    console.log('Railway: calculated duration:', {
      startSeconds,
      endSeconds,
      duration,
      isValid: Number.isFinite(duration) && duration > 0,
    });

    // CRITICAL: Final validation before FFmpeg
    if (!Number.isFinite(duration) || duration <= 0 || Number.isNaN(duration)) {
      console.error('Railway: CRITICAL - invalid duration calculated', { 
        startTime, 
        endTime, 
        startSeconds, 
        endSeconds, 
        duration 
      });
      return res.status(400).json({
        error: 'Invalid duration calculated',
        details: { startTime, endTime, startSeconds, endSeconds, duration },
      });
    }

    // Process video with FFmpeg
    console.log('Railway: starting FFmpeg with params:', {
      vodUrl,
      startSeconds,
      duration,
      outputPath,
    });

    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(vodUrl)
        .inputOptions([
          '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
        ])
        .seekInput(startSeconds)
        .duration(duration)
        .outputOptions([
          '-c copy',
          '-avoid_negative_ts', 'make_zero',
          '-copyts',
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('Railway: FFmpeg command:', cmd);
          // Verify no NaN in command
          if (cmd.includes('NaN') || cmd.includes('undefined')) {
            console.error('Railway: CRITICAL - FFmpeg command contains NaN or undefined!');
            reject(new Error('Invalid FFmpeg command - contains NaN or undefined'));
          }
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log('Railway: processing:', `${progress.percent.toFixed(2)}%`);
          }
        })
        .on('stderr', (stderrLine) => {
          console.log('Railway: FFmpeg stderr:', stderrLine);
        })
        .on('end', () => {
          console.log('Railway: FFmpeg processing complete');
          resolve(null);
        })
        .on('error', (err, stdout, stderr) => {
          console.error('Railway: FFmpeg error:', err.message);
          console.error('Railway: FFmpeg stdout:', stdout);
          console.error('Railway: FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg failed: ${err.message}`));
        });

      command.run();
    });

    // Read output file
    const outputBuffer = await fs.readFile(outputPath);
    console.log('Railway: output file size:', outputBuffer.length, 'bytes');

    if (outputBuffer.length === 0) {
      throw new Error('FFmpeg produced empty output file');
    }

    // Verify MP4 header (ftyp box)
    const header = outputBuffer.slice(0, 12);
    const isFtyp =
      (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) ||
      (header[8] === 0x66 && header[9] === 0x74 && header[10] === 0x79 && header[11] === 0x70);

    if (!isFtyp) {
      const headerHex = Array.from(header)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.warn('Railway: output may not be valid MP4, header:', headerHex);
    } else {
      console.log('Railway: valid MP4 header detected');
    }

    // Clean up temp file
    await fs.unlink(outputPath).catch((err) => console.warn('Railway: cleanup warning:', err));

    // Send MP4 back to client
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="clip.mp4"',
      'Content-Length': outputBuffer.length,
    });
    res.send(outputBuffer);

    console.log('Railway: successfully sent MP4 to client');
  } catch (error) {
    console.error('Railway: clip processing error:', error);
    console.error('Railway: error stack:', error.stack);

    // Clean up on error
    try {
      await fs.unlink(outputPath).catch(() => {});
    } catch (cleanupError) {
      console.warn('Railway: cleanup error:', cleanupError);
    }

    res.status(500).json({
      error: 'FFmpeg failed',
      details: error.message,
    });
  }
});

// Log yt-dlp version if available
async function logYtDlpVersion() {
  try {
    const { stdout } = await execAsync('yt-dlp --version');
    console.log('yt-dlp available, version:', stdout.trim());
  } catch (err) {
    console.warn('yt-dlp not found (optional)');
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Railway FFmpeg Service listening on port ${PORT}`);
  console.log(`FFmpeg path: ${ffmpegStatic}`);
  console.log(`Node version: ${process.version}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  logYtDlpVersion().catch(() => {});
});
