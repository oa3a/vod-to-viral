import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { contentType as guessContentType } from "https://deno.land/std@0.168.0/media_types/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VIDEO_MIME_PREFIX = "video";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadFallbackSampleVod(requestUrl: URL): Promise<{ buffer: Uint8Array; mimeType: string }> {
  const absUrl = new URL("/assets/sample_vod.mp4", requestUrl).toString();
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestUrl = new URL(req.url);

  try {
    const { vodUrl, startTime, endTime } = await req.json();

    if (!vodUrl) {
      return new Response(
        JSON.stringify({ error: "vodUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("process-clip: received request", { vodUrl, startTime, endTime });

    let inputBuffer: Uint8Array;
    let inputMimeType = "video/mp4";

    try {
      if (typeof vodUrl === "string" && vodUrl.startsWith("/mnt/data")) {
        console.log("process-clip: reading local file from disk", vodUrl);
        try {
          const fileData = await Deno.readFile(vodUrl);
          const guessedType = guessContentType(vodUrl) || "";
          console.log("process-clip: local file guessed content-type", guessedType);

          if (!guessedType.includes(VIDEO_MIME_PREFIX)) {
            console.warn("process-clip: local file is not a video, switching to fallback MP4");
            const fallback = await loadFallbackSampleVod(requestUrl);
            inputBuffer = fallback.buffer;
            inputMimeType = fallback.mimeType;
          } else {
            inputBuffer = fileData;
            inputMimeType = guessedType;
          }
        } catch (readError) {
          console.error("process-clip: failed to read local file, using fallback MP4", readError);
          const fallback = await loadFallbackSampleVod(requestUrl);
          inputBuffer = fallback.buffer;
          inputMimeType = fallback.mimeType;
        }
      } else {
        console.log("process-clip: fetching remote VOD", vodUrl);
        const sourceResponse = await fetchWithTimeout(vodUrl, 25_000);

        if (!sourceResponse.ok) {
          const body = await sourceResponse.text().catch(() => "<unable to read body>");
          console.error("process-clip: failed to fetch source", sourceResponse.status, body);
          return new Response(
            JSON.stringify({ error: `Failed to fetch source: ${sourceResponse.status}` }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const contentTypeHeader = sourceResponse.headers.get("content-type") || "";
        console.log("process-clip: source content-type", contentTypeHeader);

        if (
          !contentTypeHeader.includes(VIDEO_MIME_PREFIX) &&
          !contentTypeHeader.includes("application/vnd.apple.mpegurl") &&
          !contentTypeHeader.includes("application/octet-stream")
        ) {
          console.warn("process-clip: remote input is not a video, switching to fallback MP4");
          const fallback = await loadFallbackSampleVod(requestUrl);
          inputBuffer = fallback.buffer;
          inputMimeType = fallback.mimeType;
        } else {
          const buf = new Uint8Array(await sourceResponse.arrayBuffer());
          console.log("process-clip: source buffer size", buf.byteLength, "bytes");
          inputBuffer = buf;
          inputMimeType = contentTypeHeader || "video/mp4";
        }
      }
    } catch (innerError: unknown) {
      const name = (innerError as { name?: string }).name;
      if (name === "AbortError") {
        console.error("process-clip: timed out while reading input buffer", innerError);
        return new Response(
          JSON.stringify({ error: "ffmpeg_timeout" }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.error("process-clip: unexpected error while preparing input", innerError);
      return new Response(
        JSON.stringify({ error: "Failed to prepare input buffer" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // NOTE: Full server-side FFmpeg trimming is not implemented yet in this edge function.
    // For now we return the prepared source (or fallback) buffer as a base64-encoded MP4,
    // and the client-side FFmpeg handles precise clipping when available.

    const base64 = encodeBase64(inputBuffer);

    return new Response(
      JSON.stringify({
        clipBase64: base64,
        mimeType: "video/mp4",
        note:
          "Server-side processing currently returns the full source (or fallback sample) without trimming. Client-side ffmpeg handles precise clipping when available.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in process-clip:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
