import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeTime(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const hh = hours.toString().padStart(2, "0");
    const mm = minutes.toString().padStart(2, "0");
    const ss = seconds.toString().padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  if (typeof value === "string") {
    if (value.includes(":")) {
      return value;
    }

    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return normalizeTime(asNumber, label);
    }
  }

  console.warn(`process-clip: received unexpected ${label} value:`, value);
  throw new Error(`Invalid ${label} value`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      console.error("process-clip: invalid JSON body");
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { vodUrl, startTime, endTime } = body as {
      vodUrl?: string;
      startTime?: unknown;
      endTime?: unknown;
    };

    if (!vodUrl || typeof vodUrl !== "string") {
      console.error("process-clip: missing or invalid vodUrl");
      return new Response(JSON.stringify({ error: "vodUrl is required and must be a string" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (startTime == null || endTime == null) {
      console.error("process-clip: missing startTime or endTime");
      return new Response(JSON.stringify({ error: "startTime and endTime are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!vodUrl.startsWith("http://") && !vodUrl.startsWith("https://")) {
      console.error("process-clip: vodUrl is not absolute:", vodUrl);
      return new Response(JSON.stringify({ error: "vodUrl must be an absolute URL starting with http:// or https://" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("process-clip: received request", { vodUrl, startTime, endTime });

    // Normalize times to HH:MM:SS
    const normalizedStart = normalizeTime(startTime, "startTime");
    const normalizedEnd = normalizeTime(endTime, "endTime");

    console.log("process-clip: normalized times", { normalizedStart, normalizedEnd });

    // Get FFmpeg service URL
    let ffmpegServiceUrl = Deno.env.get("FFMPEG_SERVICE_URL")?.trim();

    if (!ffmpegServiceUrl) {
      console.error("process-clip: FFMPEG_SERVICE_URL not configured");
      return new Response(JSON.stringify({ error: "FFMPEG_SERVICE_URL environment variable not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("process-clip: FFMPEG_SERVICE_URL from env:", ffmpegServiceUrl);

    // Normalize service URL
    if (!ffmpegServiceUrl.startsWith("http://") && !ffmpegServiceUrl.startsWith("https://")) {
      ffmpegServiceUrl = "https://" + ffmpegServiceUrl;
      console.log("process-clip: added https:// prefix:", ffmpegServiceUrl);
    }

    ffmpegServiceUrl = ffmpegServiceUrl.replace(/\/$/, "");

    if (!ffmpegServiceUrl.endsWith("/clip")) {
      ffmpegServiceUrl = ffmpegServiceUrl + "/clip";
    }

    console.log("process-clip: final FFmpeg service URL:", ffmpegServiceUrl);

    // Forward request to Railway FFmpeg service
    console.log("process-clip: forwarding to Railway with payload:", {
      vodUrl,
      startTime: normalizedStart,
      endTime: normalizedEnd,
    });

    const backendRes = await fetch(ffmpegServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vodUrl,
        startTime: normalizedStart,
        endTime: normalizedEnd,
      }),
    });

    console.log("process-clip: Railway response status:", backendRes.status);

    if (!backendRes.ok) {
      const text = await backendRes.text().catch(() => "");
      console.error("process-clip: Railway request failed", {
        status: backendRes.status,
        statusText: backendRes.statusText,
        body: text,
      });

      return new Response(
        JSON.stringify({
          error: "Railway FFmpeg service failed",
          status: backendRes.status,
          details: text,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const mp4Buffer = await backendRes.arrayBuffer();

    if (!mp4Buffer || mp4Buffer.byteLength === 0) {
      console.error("process-clip: Railway returned empty body");
      return new Response(
        JSON.stringify({
          error: "Railway FFmpeg service returned empty response",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("process-clip: received MP4 from Railway, bytes:", mp4Buffer.byteLength);

    return new Response(mp4Buffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="clip.mp4"',
        "Content-Length": mp4Buffer.byteLength.toString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("process-clip: unexpected error", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
