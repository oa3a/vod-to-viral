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
    const { vodId } = await req.json();

    if (!vodId) {
      return new Response(
        JSON.stringify({ error: "VOD ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("proxy-vod: fetching VOD ID", vodId);

    const clientId = Deno.env.get("TWITCH_CLIENT_ID");
    const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "Twitch credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get OAuth token
    console.log("proxy-vod: getting OAuth token...");
    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error("proxy-vod: token error", tokenError);
      return new Response(
        JSON.stringify({ error: "Failed to authenticate with Twitch" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { access_token } = await tokenResponse.json();
    console.log("proxy-vod: OAuth token obtained");

    // Construct the VOD stream URL
    // Note: Twitch's vod-secure URLs may require additional authentication beyond OAuth
    // This is a simplified implementation that may need enhancement
    const streamUrl = `https://vod-secure.twitch.tv/_${vodId}/chunked/index-dvr.m3u8`;

    console.log("proxy-vod: attempting to fetch stream", streamUrl);

    // Try to fetch the HLS stream with authentication
    const vodResponse = await fetch(streamUrl, {
      headers: {
        "Client-ID": clientId,
        "Authorization": `Bearer ${access_token}`,
      },
    });

    if (!vodResponse.ok) {
      const errorBody = await vodResponse.text();
      console.error("proxy-vod: failed to fetch stream", vodResponse.status, errorBody);
      
      return new Response(
        JSON.stringify({ 
          error: `Twitch VOD access failed: ${vodResponse.status}`,
          details: "Twitch secure VODs require additional authentication. Consider using test mode with sample videos.",
          vodId: vodId
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Stream the content back with CORS headers
    const contentType = vodResponse.headers.get("content-type") || "application/vnd.apple.mpegurl";
    console.log("proxy-vod: streaming content, type:", contentType);

    return new Response(vodResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
      },
    });

  } catch (error) {
    console.error("Error in proxy-vod:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        note: "For testing purposes, use test mode with local MP4 files or the sample video fallback."
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
