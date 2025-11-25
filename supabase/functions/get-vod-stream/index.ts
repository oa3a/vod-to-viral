import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vodId } = await req.json();

    if (!vodId) {
      return new Response(
        JSON.stringify({ error: 'VOD ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('get-vod-stream: fetching stream for VOD ID:', vodId);

    const clientId = Deno.env.get('TWITCH_CLIENT_ID');

    if (!clientId) {
      console.error('get-vod-stream: missing Twitch client ID');
      return new Response(
        JSON.stringify({ error: 'Twitch credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Get VOD access token from Twitch
    console.log('get-vod-stream: fetching VOD access token...');
    const accessTokenUrl = `https://api.twitch.tv/api/vods/${vodId}/access_token`;
    
    const tokenResponse = await fetch(accessTokenUrl, {
      headers: {
        'Client-ID': clientId,
      },
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error('get-vod-stream: access token fetch failed:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Failed to get VOD access token from Twitch' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData = await tokenResponse.json();
    console.log('get-vod-stream: access token obtained');

    // Step 2: Get the signed m3u8 playlist URL from Twitch Usher
    const token = encodeURIComponent(tokenData.token);
    const sig = tokenData.sig;
    
    const usherUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${token}&nauthsig=${sig}&allow_source=true&player=twitchweb`;
    console.log('get-vod-stream: fetching playlist from Usher...');

    const playlistResponse = await fetch(usherUrl, {
      headers: {
        'Client-ID': clientId,
      },
    });

    if (!playlistResponse.ok) {
      const playlistError = await playlistResponse.text();
      console.error('get-vod-stream: playlist fetch failed:', playlistError);
      return new Response(
        JSON.stringify({ error: 'Failed to get VOD playlist from Twitch' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the master playlist to get the chunked (source quality) stream URL
    const playlistText = await playlistResponse.text();
    console.log('get-vod-stream: received master playlist');

    // Extract the chunked (source quality) stream URL from the master playlist
    const lines = playlistText.split('\n');
    let chunkedUrl = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for the chunked (source quality) stream
      if (line.includes('chunked') || line.includes('VIDEO="chunked"')) {
        // The URL is on the next non-comment line
        for (let j = i + 1; j < lines.length; j++) {
          const urlLine = lines[j].trim();
          if (urlLine && !urlLine.startsWith('#')) {
            chunkedUrl = urlLine;
            break;
          }
        }
        break;
      }
    }

    // If we didn't find chunked, use the first stream URL
    if (!chunkedUrl) {
      console.log('get-vod-stream: chunked stream not found, using first stream');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('http')) {
          chunkedUrl = trimmed;
          break;
        }
      }
    }

    if (!chunkedUrl) {
      console.error('get-vod-stream: no stream URL found in playlist');
      return new Response(
        JSON.stringify({ error: 'No stream URL found in VOD playlist' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('get-vod-stream: extracted stream URL:', chunkedUrl);
    console.log('get-vod-stream: URL includes token=', chunkedUrl.includes('token='));
    console.log('get-vod-stream: URL includes sig=', chunkedUrl.includes('sig='));

    // Fetch VOD metadata for title and duration
    const clientSecret = Deno.env.get('TWITCH_CLIENT_SECRET');
    if (!clientSecret) {
      // Return stream URL without metadata
      return new Response(
        JSON.stringify({ 
          streamUrl: chunkedUrl,
          vodTitle: 'Unknown',
          vodDuration: 'Unknown',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get OAuth token for Helix API
    const oauthResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (oauthResponse.ok) {
      const { access_token } = await oauthResponse.json();
      
      // Fetch VOD metadata
      const vodResponse = await fetch(`https://api.twitch.tv/helix/videos?id=${vodId}`, {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${access_token}`,
        },
      });

      if (vodResponse.ok) {
        const vodData = await vodResponse.json();
        if (vodData.data && vodData.data.length > 0) {
          const vod = vodData.data[0];
          return new Response(
            JSON.stringify({ 
              streamUrl: chunkedUrl,
              vodTitle: vod.title,
              vodDuration: vod.duration,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Return stream URL without detailed metadata if Helix API fails
    return new Response(
      JSON.stringify({ 
        streamUrl: chunkedUrl,
        vodTitle: 'Unknown',
        vodDuration: 'Unknown',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('get-vod-stream: unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
