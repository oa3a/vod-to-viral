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
    
    // Construct Twitch VOD HLS stream URL
    // Twitch uses CloudFront CDN for VOD delivery
    const streamUrl = `https://d2nvs31859zcd8.cloudfront.net/${vodId}_${vod.user_login}_${vod.created_at}/chunked/index-dvr.m3u8`;
    console.log('get-vod-stream: constructed stream URL:', streamUrl);

    // Verify the URL is absolute
    if (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://')) {
      console.error('get-vod-stream: generated URL is not absolute:', streamUrl);
      return new Response(
        JSON.stringify({ error: 'Failed to generate absolute stream URL' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try to fetch the playlist to get the real URL (may redirect)
    try {
      const playlistCheck = await fetch(streamUrl, { 
        method: 'HEAD',
        redirect: 'follow' 
      });
      
      if (playlistCheck.ok) {
        // Use the final URL after redirects
        const finalUrl = playlistCheck.url || streamUrl;
        console.log('get-vod-stream: playlist accessible, final URL:', finalUrl);
        console.log('get-vod-stream: URL includes token=', finalUrl.includes('token='));
        console.log('get-vod-stream: URL includes sig=', finalUrl.includes('sig='));
        
        return new Response(
          JSON.stringify({ 
            streamUrl: finalUrl,
            vodTitle: vod.title,
            vodDuration: vod.duration,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (checkError) {
      console.warn('get-vod-stream: could not verify playlist URL:', checkError);
    }

    // Return constructed URL even if we can't verify it
    console.log('get-vod-stream: returning unverified URL:', streamUrl);
    console.log('get-vod-stream: URL includes token=', streamUrl.includes('token='));
    console.log('get-vod-stream: URL includes sig=', streamUrl.includes('sig='));
    
    return new Response(
      JSON.stringify({ 
        streamUrl,
        vodTitle: vod.title,
        vodDuration: vod.duration,
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
