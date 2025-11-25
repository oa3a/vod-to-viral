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
    const clientSecret = Deno.env.get('TWITCH_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('get-vod-stream: missing Twitch credentials');
      return new Response(
        JSON.stringify({ error: 'Twitch credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get OAuth token
    console.log('get-vod-stream: requesting OAuth token...');
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error('get-vod-stream: OAuth token failed:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with Twitch' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await tokenResponse.json();
    console.log('get-vod-stream: OAuth token obtained');

    // Fetch VOD metadata
    console.log('get-vod-stream: fetching VOD metadata...');
    const vodResponse = await fetch(`https://api.twitch.tv/helix/videos?id=${vodId}`, {
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${access_token}`,
      },
    });

    if (!vodResponse.ok) {
      const vodError = await vodResponse.text();
      console.error('get-vod-stream: VOD fetch failed:', vodError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch VOD from Twitch' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vodData = await vodResponse.json();

    if (!vodData.data || vodData.data.length === 0) {
      console.error('get-vod-stream: VOD not found');
      return new Response(
        JSON.stringify({ error: 'VOD not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vod = vodData.data[0];
    
    // Twitch VOD HLS stream URL pattern
    const streamUrl = `https://vod-secure.twitch.tv/_${vodId}/chunked/index-dvr.m3u8`;
    console.log('get-vod-stream: constructed stream URL:', streamUrl);

    // Try to fetch the playlist to validate it
    const playlistResponse = await fetch(streamUrl);
    
    if (!playlistResponse.ok) {
      console.warn('get-vod-stream: playlist URL not directly accessible (may need token)');
      // Return the URL anyway - Railway might handle authentication differently
    } else {
      console.log('get-vod-stream: playlist accessible');
    }

    return new Response(
      JSON.stringify({ 
        streamUrl,
        vodTitle: vod.title,
        vodDuration: vod.duration,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('get-vod-stream: unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
