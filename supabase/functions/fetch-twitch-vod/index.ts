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
    const { vodUrl } = await req.json();

    if (!vodUrl) {
      return new Response(
        JSON.stringify({ error: 'VOD URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract VOD ID from URL
    // Supports formats: https://www.twitch.tv/videos/123456789
    const vodIdMatch = vodUrl.match(/videos\/(\d+)/);
    if (!vodIdMatch) {
      return new Response(
        JSON.stringify({ error: 'Invalid Twitch VOD URL format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vodId = vodIdMatch[1];
    console.log('Fetching VOD ID:', vodId);

    const clientId = Deno.env.get('TWITCH_CLIENT_ID');
    const clientSecret = Deno.env.get('TWITCH_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('Missing Twitch credentials');
      return new Response(
        JSON.stringify({ error: 'Twitch credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get OAuth token
    console.log('Getting OAuth token...');
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
      console.error('Token error:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with Twitch' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await tokenResponse.json();
    console.log('OAuth token obtained');

    // Fetch VOD metadata
    console.log('Fetching VOD metadata...');
    const vodResponse = await fetch(`https://api.twitch.tv/helix/videos?id=${vodId}`, {
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${access_token}`,
      },
    });

    if (!vodResponse.ok) {
      const vodError = await vodResponse.text();
      console.error('VOD fetch error:', vodError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch VOD from Twitch' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vodData = await vodResponse.json();

    if (!vodData.data || vodData.data.length === 0) {
      return new Response(
        JSON.stringify({ error: 'VOD not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vod = vodData.data[0];
    console.log('VOD fetched:', vod.title);

    // Parse duration (format: "1h23m45s" or "23m45s" or "45s")
    const parseDuration = (duration: string): number => {
      let totalSeconds = 0;
      const hours = duration.match(/(\d+)h/);
      const minutes = duration.match(/(\d+)m/);
      const seconds = duration.match(/(\d+)s/);
      
      if (hours) totalSeconds += parseInt(hours[1]) * 3600;
      if (minutes) totalSeconds += parseInt(minutes[1]) * 60;
      if (seconds) totalSeconds += parseInt(seconds[1]);
      
      return totalSeconds;
    };

    const durationInSeconds = parseDuration(vod.duration);

    // Generate mock viral clips based on real VOD timeline
    // In production, this would use AI to detect actual viral moments
    const generateMockClips = (totalDuration: number) => {
      const clipCount = Math.min(7, Math.max(3, Math.floor(totalDuration / 600))); // 3-7 clips
      const clips = [];
      
      for (let i = 0; i < clipCount; i++) {
        const startTime = Math.floor((totalDuration / (clipCount + 1)) * (i + 1));
        const clipDuration = Math.floor(Math.random() * 20) + 12; // 12-32 seconds
        const endTime = Math.min(startTime + clipDuration, totalDuration);
        
        const formatTime = (seconds: number) => {
          const mins = Math.floor(seconds / 60);
          const secs = seconds % 60;
          return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        clips.push({
          id: i + 1,
          startTime,
          endTime,
          duration: endTime - startTime,
          formattedTime: `${formatTime(startTime)} - ${formatTime(endTime)}`,
          viralScore: 95 - (i * 3),
          title: [
            'Epic Moment',
            'Insane Play',
            'Perfect Timing',
            'Chat Goes Wild',
            'Unexpected Victory',
            'Hilarious Reaction',
            'Clutch Performance'
          ][i] || `Clip ${i + 1}`,
        });
      }
      
      return clips;
    };

    const mockClips = generateMockClips(durationInSeconds);

    return new Response(
      JSON.stringify({
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
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in fetch-twitch-vod:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
