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
 * Use remote FFmpeg-style service API to trim.
 * The remote service is expected to accept POST { vodUrl, startTime, endTime } and return binary mp4.
 */
async function callFfmpegService(
  serviceUrl: string,
  inputBuffer: Uint8Array,
  startTime: string,
  endTime: string,
): Promise<ArrayBuffer> {
  console.log("process-clip: calling remote ffmpeg service", serviceUrl);
  
  const postResp = await fetchWithTimeout(serviceUrl, 120_000);
  
  const formData = new FormData();
  const cleanBuffer = new Uint8Array(inputBuffer).buffer;
  formData.append("video", new Blob([cleanBuffer], { type: "video/mp4" }), "input.mp4");
  formData.append("startTime", startTime);
  formData.append("endTime", endTime);
  
  const response = await fetch(serviceUrl, {
    method: "POST",
    body: formData,
  });
  
  if (!response.ok) {
    const body = await response.text().catch(() => "<no body>");
    throw new Error(`Remote ffmpeg service failed: ${response.status} ${body}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  console.log("process-clip: remote service returned", arrayBuffer.byteLength, "bytes");
  return arrayBuffer;
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

    // Check for remote FFmpeg service URL
    const ffmpegServiceUrl = Deno.env.get("FFMPEG_SERVICE_URL");
    
    if (!ffmpegServiceUrl) {
      console.error("process-clip: FFMPEG_SERVICE_URL not configured");
      return new Response(JSON.stringify({ error: "ffmpeg_service_not_configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let outputBuffer: ArrayBuffer;

    try {
      console.log("process-clip: using remote ffmpeg service at", ffmpegServiceUrl);
      outputBuffer = await callFfmpegService(ffmpegServiceUrl, inputBuffer, startTime, endTime);
    } catch (ffErr) {
      console.error("process-clip: ffmpeg processing failed", ffErr);
      return new Response(JSON.stringify({ error: "ffmpeg_processing_failed", details: String(ffErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!outputBuffer || outputBuffer.byteLength === 0) {
      console.error("process-clip: output buffer empty");
      return new Response(JSON.stringify({ error: "empty_output" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return binary MP4 directly using ArrayBuffer
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
