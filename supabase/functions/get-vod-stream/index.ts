// get-vod-stream/index.ts
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
    const vodId = body?.vodId || null;

    if (!vodId || typeof vodId !== "string") {
      console.error("get-vod-stream: missing or invalid vodId");
      return jsonResponse({ error: "VOD ID is required" }, 400);
    }

    console.log("get-vod-stream: fetching stream for VOD ID:", vodId);

    const clientId = Deno.env.get("TWITCH_CLIENT_ID");
    const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!clientId || !clientSecret) {
      console.error("get-vod-stream: missing Twitch credentials");
      return jsonResponse({ error: "Twitch credentials not configured" }, 500);
    }
    if (!supabaseUrl || !supabaseUrl.startsWith("http")) {
      console.error("get-vod-stream: SUPABASE_URL missing or invalid:", supabaseUrl);
      return jsonResponse({ error: "SUPABASE_URL is not configured" }, 500);
    }

    // Step 1: Get OAuth token (client credentials)
    console.log("get-vod-stream: requesting OAuth token...");
    const oauthRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!oauthRes.ok) {
      const text = await oauthRes.text().catch(() => "");
      console.error("get-vod-stream: failed to obtain oauth token:", oauthRes.status, text);
      return jsonResponse({ error: "Failed to get OAuth token from Twitch" }, 500);
    }
    const oauthJson = await oauthRes.json().catch(() => null);
    const access_token = oauthJson?.access_token;
    if (!access_token) {
      console.error("get-vod-stream: oauth response missing access_token", oauthJson);
      return jsonResponse({ error: "Invalid OAuth response" }, 500);
    }

    console.log("get-vod-stream: OAuth token obtained");

    // Step 2: Get playback access token using Twitch GraphQL (official playback flow)
    console.log("get-vod-stream: requesting playback access token via GraphQL...");
    const graphqlQuery = {
      operationName: "PlaybackAccessToken",
      variables: {
        isLive: false,
        login: "",
        isVod: true,
        vodID: vodId,
        playerType: "embed",
      },
      extensions: {
        persistedQuery: {
          version: 1,
          // This is the public persistedQuery hash used by Twitch web client
          sha256Hash: "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712",
        },
      },
    };

    const gqlRes = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", // public web client id expected by Twitch
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(graphqlQuery),
    });

    if (!gqlRes.ok) {
      const txt = await gqlRes.text().catch(() => "");
      console.error("get-vod-stream: GraphQL playback token failed:", gqlRes.status, txt);
      return jsonResponse({ error: "Failed to get playback access token from Twitch" }, 500);
    }

    const gqlJson = await gqlRes.json().catch(() => null);
    const tokenData = gqlJson?.data?.videoPlaybackAccessToken;
    if (!tokenData || !tokenData.value || !tokenData.signature) {
      console.error("get-vod-stream: invalid GraphQL data:", gqlJson);
      return jsonResponse({ error: "Invalid playback access token response" }, 500);
    }

    console.log("get-vod-stream: playback access token obtained");

    // Step 3: Fetch the master playlist from Usher with signed token/sig
    const token = encodeURIComponent(tokenData.value);
    const sig = tokenData.signature;
    const usherUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${token}&nauthsig=${sig}&allow_source=true&player=twitchweb`;

    console.log("get-vod-stream: fetching master playlist from Usher...");
    const playlistRes = await fetch(usherUrl, {
      headers: {
        "Client-ID": clientId,
      },
    });

    if (!playlistRes.ok) {
      const txt = await playlistRes.text().catch(() => "");
      console.error("get-vod-stream: Usher playlist fetch failed:", playlistRes.status, txt);
      return jsonResponse({ error: "Failed to get VOD playlist from Twitch" }, 500);
    }

    const playlistText = await playlistRes.text();
    console.log("get-vod-stream: master playlist fetched, length:", playlistText.length);

    const lines = playlistText.split("\n").map((l) => l.trim());
    // find chunked (source) or the first http stream
    let chunkedUrl = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (line.includes("chunked") || line.includes('VIDEO="chunked"')) {
        // url is likely on next non-comment line
        for (let j = i + 1; j < lines.length; j++) {
          const urlLine = lines[j];
          if (urlLine && !urlLine.startsWith("#")) {
            chunkedUrl = urlLine;
            break;
          }
        }
        if (chunkedUrl) break;
      }
    }
    if (!chunkedUrl) {
      // fallback: first http line
      for (const l of lines) {
        if (l && !l.startsWith("#") && l.startsWith("http")) {
          chunkedUrl = l;
          break;
        }
      }
    }

    if (!chunkedUrl) {
      console.error("get-vod-stream: playlist parsing found no stream URLs");
      return jsonResponse({ error: "No stream URL found in VOD playlist" }, 500);
    }

    console.log("get-vod-stream: extracted chunked URL:", chunkedUrl);

    // CRITICAL: Validate that chunkedUrl is absolute
    if (!chunkedUrl.startsWith("http://") && !chunkedUrl.startsWith("https://")) {
      console.error("get-vod-stream: chunked URL is not absolute:", chunkedUrl);
      return jsonResponse({ error: "Extracted stream URL is not absolute" }, 500);
    }

    // Step 4: Build rewritten URL that calls our rewrite m3u8 function to convert relative segments -> absolute
    const encoded = encodeURIComponent(chunkedUrl);
    const baseSupabase = supabaseUrl.replace(/\/$/, "");
    const rewrittenUrl = `${baseSupabase}/functions/v1/rewrite-m3u8?url=${encoded}`;

    console.log("get-vod-stream: rewritten URL ready:", rewrittenUrl);

    // Step 5: (optional) fetch video metadata via Helix (title/duration) using the oauth token
    let vodTitle = "Unknown";
    let vodDuration = "Unknown";
    try {
      const metaRes = await fetch(`https://api.twitch.tv/helix/videos?id=${vodId}`, {
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${access_token}`,
        },
      });
      if (metaRes.ok) {
        const metaJson = await metaRes.json().catch(() => null);
        if (metaJson?.data?.length) {
          vodTitle = metaJson.data[0].title ?? vodTitle;
          vodDuration = metaJson.data[0].duration ?? vodDuration;
        }
      } else {
        console.warn("get-vod-stream: helix metadata fetch returned", metaRes.status);
      }
    } catch (metaErr) {
      console.warn("get-vod-stream: metadata fetch error (nonfatal):", metaErr);
    }

    console.log("get-vod-stream: SUCCESS - returning stream URL");
    return jsonResponse(
      {
        streamUrl: rewrittenUrl,
        vodTitle,
        vodDuration,
      },
      200
    );
  } catch (err) {
    console.error("get-vod-stream: unexpected error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
