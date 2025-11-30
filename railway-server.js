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

// Clip endpoint
app.post('/clip', async (req, res) => {
  const tempDir = path.join(__dirname, 'temp');
  const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);

  try {
    const { vodUrl, startTime, endTime } = req.body;

    // Validate input
    if (!vodUrl || startTime == null || endTime == null) {
      console.error('Railway: missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: vodUrl, startTime, endTime',
      });
    }

    console.log('Railway: received clip request', { vodUrl, startTime, endTime });

    // Validate vodUrl is absolute
    if (typeof vodUrl !== 'string' || (!vodUrl.startsWith('http://') && !vodUrl.startsWith('https://'))) {
      console.error('Railway: invalid vodUrl (not absolute):', vodUrl);
      return res.status(400).json({
        error: 'vodUrl must be an absolute URL starting with http:// or https://',
        received: vodUrl,
      });
    }

    console.log('Railway: validated absolute vodUrl:', vodUrl);

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Convert times to seconds for duration calculation
    const startSeconds = parseTimeToSeconds(startTime);
    const endSeconds = parseTimeToSeconds(endTime);
    const duration = endSeconds - startSeconds;

    if (isNaN(duration) || duration <= 0) {
      console.error('Railway: invalid duration calculated', { startSeconds, endSeconds, duration });
      return res.status(400).json({
        error: 'Invalid time range',
        details: `startTime=${startTime}, endTime=${endTime} resulted in duration=${duration}`,
      });
    }

    console.log('Railway: calculated duration:', { startSeconds, endSeconds, duration });

    // Process video with FFmpeg
    console.log('Railway: starting FFmpeg processing for HLS stream');

    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(vodUrl)
        .inputOptions([
          '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
        ])
        .seekInput(startTime)
        .duration(duration)
        .outputOptions([
          '-c copy',
          '-avoid_negative_ts', 'make_zero',
          '-copyts',
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('Railway: FFmpeg command:', cmd);
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

// Helper: Convert HH:MM:SS, MM:SS, or seconds to seconds
function parseTimeToSeconds(time) {
  // If already a number, return it
  if (typeof time === 'number' && Number.isFinite(time)) {
    return time;
  }

  const str = String(time);

  // Check if it's in HH:MM:SS or MM:SS format
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);

    if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    }
  }

  // Otherwise try to parse as number
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
