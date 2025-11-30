// fetch-twitch-vod/index.ts
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    const vodUrl = (body as any)?.vodUrl as string | undefined;

    if (!vodUrl || typeof vodUrl !== "string") {
      console.error("fetch-twitch-vod: missing or invalid vodUrl");
      return jsonResponse({ error: "VOD URL is required" }, 400);
    }

    console.log("fetch-twitch-vod: processing URL:", vodUrl);

    // Extract VOD ID from URL
    const vodIdMatch = vodUrl.match(/videos\/(\d+)/);
    if (!vodIdMatch) {
      console.error("fetch-twitch-vod: invalid URL format:", vodUrl);
      return jsonResponse(
        { error: "Invalid Twitch VOD URL format. Expected: https://www.twitch.tv/videos/123456789" },
        400,
      );
    }

    const vodId = vodIdMatch[1];
    console.log("fetch-twitch-vod: extracted VOD ID:", vodId);

    const clientId = Deno.env.get("TWITCH_CLIENT_ID");
    const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      console.error("fetch-twitch-vod: missing Twitch credentials");
      return jsonResponse({ error: "Twitch credentials not configured" }, 500);
    }

    // Get OAuth token
    console.log("fetch-twitch-vod: requesting OAuth token...");
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      console.error("fetch-twitch-vod: OAuth failed:", tokenRes.status, text);
      return jsonResponse({ error: "Failed to authenticate with Twitch" }, 500);
    }

    const tokenData = await tokenRes.json().catch(() => null as any);
    const access_token = tokenData?.access_token as string | undefined;

    if (!access_token) {
      console.error("fetch-twitch-vod: OAuth response missing access_token", tokenData);
      return jsonResponse({ error: "Invalid OAuth response from Twitch" }, 500);
    }

    console.log("fetch-twitch-vod: OAuth token obtained");

    // Fetch VOD metadata from Helix API
    console.log("fetch-twitch-vod: fetching VOD metadata...");
    const vodRes = await fetch(`https://api.twitch.tv/helix/videos?id=${vodId}`, {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!vodRes.ok) {
      const text = await vodRes.text().catch(() => "");
      console.error("fetch-twitch-vod: VOD fetch failed:", vodRes.status, text);
      return jsonResponse({ error: "Failed to fetch VOD from Twitch" }, 500);
    }

    const vodData = await vodRes.json().catch(() => null as any);

    if (!vodData?.data || vodData.data.length === 0) {
      console.error("fetch-twitch-vod: VOD not found:", vodId);
      return jsonResponse({ error: "VOD not found" }, 404);
    }

    const vod = vodData.data[0];
    console.log("fetch-twitch-vod: VOD metadata:", {
      title: vod.title,
      duration: vod.duration,
      user: vod.user_name,
    });

    // Parse duration (format: "1h23m45s" or "23m45s" or "45s")
    const parseDuration = (duration: string): number => {
      let totalSeconds = 0;
      const hours = duration.match(/(\d+)h/);
      const minutes = duration.match(/(\d+)m/);
      const seconds = duration.match(/(\d+)s/);

      if (hours) totalSeconds += parseInt(hours[1], 10) * 3600;
      if (minutes) totalSeconds += parseInt(minutes[1], 10) * 60;
      if (seconds) totalSeconds += parseInt(seconds[1], 10);

      return totalSeconds;
    };

    const durationInSeconds = parseDuration(vod.duration as string);
    console.log("fetch-twitch-vod: duration in seconds:", durationInSeconds);

    // Generate mock viral clips based on VOD timeline
    const generateMockClips = (totalDuration: number) => {
      const clipCount = Math.min(7, Math.max(3, Math.floor(totalDuration / 600)));
      const clips = [] as any[];

      for (let i = 0; i < clipCount; i++) {
        const startTime = Math.floor((totalDuration / (clipCount + 1)) * (i + 1));
        const clipDuration = Math.floor(Math.random() * 20) + 12; // 12-32 seconds
        const endTime = Math.min(startTime + clipDuration, totalDuration);

        const formatTime = (seconds: number) => {
          const mins = Math.floor(seconds / 60);
          const secs = seconds % 60;
          return `${mins}:${secs.toString().padStart(2, "0")}`;
        };

        clips.push({
          id: i + 1,
          startTime,
          endTime,
          duration: endTime - startTime,
          formattedTime: `${formatTime(startTime)} - ${formatTime(endTime)}`,
          viralScore: 95 - i * 3,
          title:
            [
              "Epic Moment",
              "Insane Play",
              "Perfect Timing",
              "Chat Goes Wild",
              "Unexpected Victory",
              "Hilarious Reaction",
              "Clutch Performance",
            ][i] || `Clip ${i + 1}`,
        });
      }

      return clips;
    };

    const mockClips = generateMockClips(durationInSeconds);
    console.log("fetch-twitch-vod: generated", mockClips.length, "clips");

    return jsonResponse({
      vodId,
      title: vod.title,
      duration: vod.duration,
      durationInSeconds,
      thumbnail: vod.thumbnail_url,
      url: vod.url,
      createdAt: vod.created_at,
      viewCount: vod.view_count,
      userName: vod.user_name,
      clips: mockClips,
    });
  } catch (err) {
    console.error("fetch-twitch-vod: unexpected error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
