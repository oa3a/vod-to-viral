import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vodUrl, startTime, endTime } = await req.json();

    if (!vodUrl || startTime == null || endTime == null) {
      return new Response(JSON.stringify({ error: "vodUrl, startTime and endTime required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Call Railway backend (which returns MP4)
    const backendRes = await fetch("https://ffmpeg-clip-service-production.up.railway.app/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vodUrl, startTime, endTime }),
    });

    if (!backendRes.ok) {
      const text = await backendRes.text();
      return new Response(JSON.stringify({ error: "Railway failed", details: text }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Read MP4 binary as ArrayBuffer
    const mp4Buffer = await backendRes.arrayBuffer();

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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
