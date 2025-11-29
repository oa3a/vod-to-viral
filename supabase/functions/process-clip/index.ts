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
    // If it's already in some H:M:S format, trust it.
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
      return new Response(JSON.stringify({ error: "vodUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (startTime == null || endTime == null) {
      return new Response(JSON.stringify({ error: "startTime and endTime are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!vodUrl.startsWith("http://") && !vodUrl.startsWith("https://")) {
      return new Response(JSON.stringify({ error: "vodUrl must be an absolute URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("process-clip: received request", { vodUrl, startTime, endTime });

    // Normalize times to HH:MM:SS for Railway
    const normalizedStart = normalizeTime(startTime, "startTime");
    const normalizedEnd = normalizeTime(endTime, "endTime");

    const base = Deno.env.get("FFMPEG_SERVICE_URL") ||
      "https://ffmpeg-clip-service-production.up.railway.app";

    let backendUrl = base.trim();
    if (!backendUrl.endsWith("/clip")) {
      backendUrl = backendUrl.replace(/\/$/, "");
      backendUrl = `${backendUrl}/clip`;
    }

    console.log("process-clip: forwarding to Railway", {
      backendUrl,
      normalizedStart,
      normalizedEnd,
    });

    const backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vodUrl,
        startTime: normalizedStart,
        endTime: normalizedEnd,
      }),
    });

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
        },
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
        },
      );
    }

    console.log("process-clip: returning MP4 to client, bytes:", mp4Buffer.byteLength);

    return new Response(mp4Buffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="clip.mp4"',
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
