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

    if (!vodUrl || startTime === undefined || endTime === undefined) {
      console.error("process-clip: missing parameters:", { vodUrl, startTime, endTime });
      return new Response(
        JSON.stringify({ error: "vodUrl, startTime, and endTime are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("process-clip: received request:", { vodUrl, startTime, endTime });

    // CRITICAL: Validate vodUrl is absolute
    if (!vodUrl.startsWith('http://') && !vodUrl.startsWith('https://')) {
      console.error("process-clip: vodUrl is not absolute:", vodUrl);
      return new Response(
        JSON.stringify({ 
          error: "vodUrl must be an absolute URL starting with http:// or https://",
          received: vodUrl 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("process-clip: validated absolute URL:", vodUrl);

    // Convert seconds to HH:MM:SS format for Railway
    const formatTime = (seconds: number): string => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const formattedStart = typeof startTime === 'string' ? startTime : formatTime(startTime);
    const formattedEnd = typeof endTime === 'string' ? endTime : formatTime(endTime);

    console.log("process-clip: formatted times:", { formattedStart, formattedEnd });

    // Call Railway FFmpeg service
    const railwayUrl = "https://ffmpeg-clip-service-production.up.railway.app/clip";
    console.log("process-clip: calling Railway at:", railwayUrl);
    console.log("process-clip: sending payload:", JSON.stringify({
      vodUrl,
      startTime: formattedStart,
      endTime: formattedEnd,
    }));

    const railwayResponse = await fetch(railwayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vodUrl,
        startTime: formattedStart,
        endTime: formattedEnd,
      }),
    });

    console.log("process-clip: Railway response status:", railwayResponse.status);

    if (!railwayResponse.ok) {
      const errorText = await railwayResponse.text().catch(() => "Unable to read error");
      console.error("process-clip: Railway service error:", railwayResponse.status, errorText);
      return new Response(
        JSON.stringify({ 
          error: "Railway FFmpeg service failed", 
          status: railwayResponse.status,
          details: errorText 
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the MP4 binary data from Railway
    const mp4Data = await railwayResponse.arrayBuffer();
    console.log("process-clip: received MP4 from Railway:", mp4Data.byteLength, "bytes");

    if (mp4Data.byteLength === 0) {
      console.error("process-clip: Railway returned empty MP4");
      return new Response(
        JSON.stringify({ error: "Railway returned empty video file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify MP4 header
    const header = new Uint8Array(mp4Data.slice(0, 12));
    const headerHex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log("process-clip: MP4 header:", headerHex);

    // Return the MP4 directly to frontend
    console.log("process-clip: returning MP4 to client");
    return new Response(mp4Data, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="clip.mp4"',
      },
    });
  } catch (error) {
    console.error("process-clip: unexpected error", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        type: error instanceof Error ? error.constructor.name : typeof error
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
