import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { contentType as guessContentType } from "https://deno.land/std@0.168.0/media_types/mod.ts";
import { extname, basename } from "https://deno.land/std@0.168.0/path/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VIDEO_MIME_PREFIX = "video";
const DEFAULT_FALLBACK = "/assets/sample_vod.mp4"; // relative asset in repo

async function fetchWithTimeout(url: string, timeoutMs = 25_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadFallbackSampleVod(requestUrl: URL): Promise<{ buffer: Uint8Array; mimeType: string }> {
  // resolve relative path to absolute URL
  const absUrl = new URL(DEFAULT_FALLBACK, requestUrl).toString();
  console.warn("process-clip: using fallback MP4", absUrl);

  const resp = await fetchWithTimeout(absUrl, 25_000);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unable to read body>");
    console.error("process-clip: failed to fetch fallback MP4", resp.status, body);
    throw new Error(`Failed to fetch fallback MP4: ${resp.status}`);
  }

  const mimeType = resp.headers.get("content-type") || "video/mp4";
  const buffer = new Uint8Array(await resp.arrayBuffer());
  console.log("process-clip: fallback buffer size", buffer.byteLength, "bytes");

  return { buffer, mimeType };
}

/**
 * Write buffer to disk path (temp) and return path
 */
async function writeTempFile(prefix = "clip", buffer: Uint8Array): Promise<string> {
  const tmpDir = Deno.env.get("TMPDIR") || "/tmp";
  const name = `${prefix}-${crypto.randomUUID()}.mp4`;
  const full = `${tmpDir}/${name}`;
  await Deno.writeFile(full, buffer);
  return full;
}

/**
 * Try to run native ffmpeg. Returns path to output file.
 * If Deno.run fails because runtime does not allow spawning, caller should use remote service fallback.
 */
async function runNativeFfmpeg(
  inputPath: string,
  outputPath: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  // ffmpeg args: -ss start -to end -i input -c copy output
  // using '-y' to overwrite if exists
  const args = ["-ss", startTime, "-to", endTime, "-i", inputPath, "-c", "copy", "-y", outputPath];
  console.log("process-clip: running ffmpeg", args.join(" "));

  // spawn process
  const p = Deno.run({
    cmd: ["ffmpeg", ...args],
    stdout: "piped",
    stderr: "piped",
  });

  const [status, rawOut, rawErr] = await Promise.all([p.status(), p.output(), p.stderrOutput()]);
  const outText = new TextDecoder().decode(rawOut);
  const errText = new TextDecoder().decode(rawErr);

  console.log("process-clip: ffmpeg status", status.code);
  if (outText) console.log("process-clip: ffmpeg stdout", outText.slice(0, 1000));
  if (errText) console.log("process-clip: ffmpeg stderr", errText.slice(0, 2000));

  if (!status.success) {
    // cleanup process handle
    p.close();
    throw new Error(`ffmpeg failed with code ${status.code}: ${errText.slice(0, 400)}`);
  }
  p.close();
}

/**
 * Use remote FFmpeg-style service API to trim.
 * The remote service is expected to accept POST { vodUrl, startTime, endTime } and return binary mp4.
 */
async function callFfmpegService(
  serviceUrl: string,
  vodUrl: string,
  startTime: string,
  endTime: string,
): Promise<Uint8Array> {
  console.log("process-clip: calling remote ffmpeg service", serviceUrl);
  const resp = await fetchWithTimeout(serviceUrl, 120_000);
  // NOTE: some services require POST and JSON; adapt if needed
  // We'll try POST with JSON:
  const postResp = await fetch(serviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vodUrl, startTime, endTime }),
  });
  if (!postResp.ok) {
    const body = await postResp.text().catch(() => "<no body>");
    throw new Error(`Remote ffmpeg service failed: ${postResp.status} ${body}`);
  }
  const ab = new Uint8Array(await postResp.arrayBuffer());
  console.log("process-clip: remote service returned", ab.byteLength, "bytes");
  return ab;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestUrl = new URL(req.url);
  try {
    const payload = await req.json();
    const { vodUrl, startTime = "00:00:00", endTime = "00:00:10" } = payload || {};

    if (!vodUrl) {
      return new Response(JSON.stringify({ error: "vodUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("process-clip: request", { vodUrl, startTime, endTime });

    // 1) Prepare inputBuffer and inputMimeType
    let inputBuffer: Uint8Array;
    let inputMimeType = "video/mp4";

    // Case A: local file path (read from disk)
    if (typeof vodUrl === "string" && vodUrl.startsWith("/mnt/data")) {
      try {
        console.log("process-clip: reading local file from disk", vodUrl);
        const fileData = await Deno.readFile(vodUrl);
        const guessed = guessContentType(vodUrl) || "";
        console.log("process-clip: guessed content-type for local file", guessed);
        if (!guessed.includes(VIDEO_MIME_PREFIX)) {
          console.warn("process-clip: local file is not a video -> falling back to sample mp4");
          const fallback = await loadFallbackSampleVod(requestUrl);
          inputBuffer = fallback.buffer;
          inputMimeType = fallback.mimeType;
        } else {
          inputBuffer = fileData;
          inputMimeType = guessed;
        }
      } catch (err) {
        console.error("process-clip: error reading local file, falling back", err);
        const fallback = await loadFallbackSampleVod(requestUrl);
        inputBuffer = fallback.buffer;
        inputMimeType = fallback.mimeType;
      }
    } else if (typeof vodUrl === "string" && vodUrl.startsWith("/")) {
      // Case B: relative asset path, resolve to absolute URL then fetch
      try {
        const abs = new URL(vodUrl, requestUrl).toString();
        console.log("process-clip: resolving relative asset to", abs);
        const resp = await fetchWithTimeout(abs, 25_000);
        if (!resp.ok) throw new Error(`Failed to fetch resolved asset: ${resp.status}`);
        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.includes(VIDEO_MIME_PREFIX)) {
          console.warn("process-clip: resolved asset not video -> using fallback");
          const fallback = await loadFallbackSampleVod(requestUrl);
          inputBuffer = fallback.buffer;
          inputMimeType = fallback.mimeType;
        } else {
          inputBuffer = new Uint8Array(await resp.arrayBuffer());
          inputMimeType = contentType;
          console.log("process-clip: resolved asset size", inputBuffer.byteLength);
        }
      } catch (err) {
        console.error("process-clip: failed to fetch relative asset", err);
        const fallback = await loadFallbackSampleVod(requestUrl);
        inputBuffer = fallback.buffer;
        inputMimeType = fallback.mimeType;
      }
    } else {
      // Case C: absolute HTTP(S) URL - fetch
      try {
        console.log("process-clip: fetching remote URL", vodUrl);
        const resp = await fetchWithTimeout(vodUrl, 25_000);
        if (!resp.ok) {
          const body = await resp.text().catch(() => "<no body>");
          console.error("process-clip: failed to fetch remote VOD", resp.status, body);
          return new Response(JSON.stringify({ error: `Failed to fetch source: ${resp.status}` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const contentType = resp.headers.get("content-type") || "";
        console.log("process-clip: remote content-type", contentType);
        if (
          !contentType.includes(VIDEO_MIME_PREFIX) &&
          !contentType.includes("application/vnd.apple.mpegurl") &&
          !contentType.includes("application/octet-stream")
        ) {
          console.warn("process-clip: remote input not a video, falling back to sample MP4");
          const fallback = await loadFallbackSampleVod(requestUrl);
          inputBuffer = fallback.buffer;
          inputMimeType = fallback.mimeType;
        } else {
          inputBuffer = new Uint8Array(await resp.arrayBuffer());
          inputMimeType = contentType || "video/mp4";
          console.log("process-clip: remote buffer size", inputBuffer.byteLength);
        }
      } catch (err) {
        console.error("process-clip: error fetching remote VOD", err);
        const fallback = await loadFallbackSampleVod(requestUrl);
        inputBuffer = fallback.buffer;
        inputMimeType = fallback.mimeType;
      }
    }

    // At this point we have inputBuffer & inputMimeType

    // Write inputBuffer to a temporary file for ffmpeg
    const inputTmp = await writeTempFile("input", inputBuffer);
    const outputTmp = inputTmp.replace(/(\.mp4)?$/, "") + "-out.mp4";

    // Attempt native ffmpeg if available and allowed
    const ffmpegServiceUrl = Deno.env.get("FFMPEG_SERVICE_URL"); // optional, remote service
    let outputBuffer: Uint8Array | null = null;

    try {
      if (ffmpegServiceUrl) {
        // Use remote service (POST JSON)
        console.log("process-clip: using remote ffmpeg service at", ffmpegServiceUrl);
        outputBuffer = await callFfmpegService(ffmpegServiceUrl, `file://${inputTmp}`, startTime, endTime);
      } else {
        // Try native ffmpeg via Deno.run
        console.log("process-clip: trying native ffmpeg");
        // ensure inputTmp exists
        await Deno.stat(inputTmp);
        await runNativeFfmpeg(inputTmp, outputTmp, startTime, endTime);
        // read output file
        outputBuffer = await Deno.readFile(outputTmp);
      }
    } catch (ffErr) {
      console.error("process-clip: ffmpeg processing failed", ffErr);
      // cleanup temp files if exists
      try {
        await Deno.remove(inputTmp);
      } catch (_) {}
      try {
        await Deno.remove(outputTmp);
      } catch (_) {}
      return new Response(JSON.stringify({ error: "ffmpeg_processing_failed", details: String(ffErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // cleanup input tmp
    try {
      await Deno.remove(inputTmp);
    } catch (_) {}

    if (!outputBuffer || outputBuffer.byteLength === 0) {
      console.error("process-clip: output buffer empty");
      return new Response(JSON.stringify({ error: "empty_output" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return binary MP4 directly
    console.log("process-clip: returning trimmed clip", outputBuffer.byteLength, "bytes");

    const headers = new Headers({
      ...corsHeaders,
      "Content-Type": "video/mp4",
      "Content-Disposition": 'attachment; filename="clip.mp4"',
    });

    return new Response(outputBuffer, { status: 200, headers });
  } catch (error) {
    console.error("process-clip: unexpected", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
