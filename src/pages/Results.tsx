import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vodUrl = location.state?.vodUrl;
  const vodData = location.state?.vodData;

  const clips = vodData?.clips || [];
  const ffmpegRef = useRef(new FFmpeg());
  const [isFFmpegLoaded, setIsFFmpegLoaded] = useState(false);
  const [downloadingClips, setDownloadingClips] = useState<Set<number>>(new Set());
  const [ffmpegLoadError, setFfmpegLoadError] = useState<string | null>(null);
  const [useServerProcessing, setUseServerProcessing] = useState(false);
  const [ffmpegLoadSeconds, setFfmpegLoadSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const maxAttempts = 3;
    const attemptTimeoutMs = 10000;

    const loadFFmpeg = async () => {
      if (isFFmpegLoaded || useServerProcessing) return;

      const ffmpeg = ffmpegRef.current;

      for (let attempt = 1; attempt <= maxAttempts && !cancelled; attempt++) {
        try {
          console.log(`ffmpeg: start load (attempt ${attempt}/${maxAttempts})`);
          setFfmpegLoadError(null);
          toast.loading(
            `Loading processor (${(attempt - 1) * (attemptTimeoutMs / 1000)}s/30s)…`,
            { id: "ffmpeg-load" },
          );

          const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
          const loadPromise = ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
          });

          console.log("ffmpeg: waiting for load with timeout", attemptTimeoutMs, "ms");
          await Promise.race([
            loadPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("ffmpeg: load timeout")), attemptTimeoutMs),
            ),
          ]);

          if (cancelled) return;

          setIsFFmpegLoaded(true);
          console.log("ffmpeg: loaded");
          toast.success("Video processor ready!", { id: "ffmpeg-load" });
          return;
        } catch (error) {
          console.error(`ffmpeg: load error on attempt ${attempt}`, error);
          if (attempt === maxAttempts && !cancelled) {
            setFfmpegLoadError(
              "FFmpeg failed to initialize. Falling back to server-side processing.",
            );
            setUseServerProcessing(true);
            toast.error(
              "Processor taking long — switching to server-side processing.",
              { id: "ffmpeg-load" },
            );
          }
        }
      }
    };

    loadFFmpeg();

    return () => {
      cancelled = true;
    };
  }, [isFFmpegLoaded, useServerProcessing]);

  useEffect(() => {
    if (isFFmpegLoaded || useServerProcessing) {
      setFfmpegLoadSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setFfmpegLoadSeconds((prev) => (prev >= 30 ? 30 : prev + 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [isFFmpegLoaded, useServerProcessing]);

  const handleDownloadClip = async (clip: any) => {
    if (!isFFmpegLoaded && !useServerProcessing) {
      toast.error('Video processor not ready yet. Please wait or enable server-side processing.');
      return;
    }

    if (downloadingClips.has(clip.id)) {
      toast.info('This clip is already being processed');
      return;
    }

    setDownloadingClips((prev) => new Set(prev).add(clip.id));

    try {
      toast.loading(`Downloading VOD...`, { id: `clip-${clip.id}` });

      let vodSourceUrl: string;

      // For testing: Use local test files or fallback to sample MP4
      const testFilePaths = [
        '/mnt/data/183cc8b2-89a7-48af-8194-99a1a83cb478.png',
        '/mnt/data/d4b5f121-4b65-4aa1-aaed-0bdf3fcdea6f.png',
      ];

      // Check if we're in test mode (no vodId or using test data)
      const isTestMode = !vodData.vodId || vodData.vodId === 'test';

      if (isTestMode) {
        console.log('Test mode: checking test files...');
        let testVideoFound = false;

        for (const path of testFilePaths) {
          try {
            console.log('Checking test file:', path);
            const testResponse = await fetch(path);
            const contentType = testResponse.headers.get('content-type') || '';
            console.log('Test file content-type:', contentType);

            if (contentType.includes('video')) {
              vodSourceUrl = path;
              testVideoFound = true;
              console.log('Using test file as video source:', path);
              break;
            }
          } catch (error) {
            console.log('Test file not accessible:', path, error);
          }
        }

        if (!testVideoFound) {
          console.log('No valid test video found, using sample MP4 fallback');
          vodSourceUrl = '/assets/sample_vod.mp4';
          toast.info('Using sample video for testing', { id: `clip-${clip.id}` });
        }
      } else {
        // Production mode: Get the HLS stream URL from edge function
        const { data: streamData, error: streamError } = await supabase.functions.invoke('get-vod-stream', {
          body: { vodId: vodData.vodId },
        });

        if (streamError || !streamData?.streamUrl) {
          throw new Error('Failed to get VOD stream URL');
        }

        vodSourceUrl = streamData.streamUrl;
        console.log('Using Twitch VOD Stream URL:', vodSourceUrl);
      }

      const startSeconds = Math.floor(clip.startTime / 1000);
      const duration = clip.duration;
      const endSeconds = startSeconds + duration;

      console.log(`Clip parameters: start=${startSeconds}s, duration=${duration}s, end=${endSeconds}s`);

      if (useServerProcessing && !isFFmpegLoaded) {
        console.log('Using server-side processing fallback via process-clip function');

        const { data, error } = await supabase.functions.invoke('process-clip', {
          body: { vodUrl: vodSourceUrl, startTime: startSeconds, endTime: endSeconds },
        });

        if (error) {
          console.error('Server-side processing error:', error);
          throw new Error('Server-side processing failed');
        }

        if (!data || typeof (data as any).clipBase64 !== 'string') {
          console.error('Invalid response from server-side processor:', data);
          throw new Error('Invalid response from server-side processor');
        }

        const responseData = data as { clipBase64: string; mimeType?: string };
        const byteCharacters = atob(responseData.clipBase64);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        const mp4Blob = new Blob([byteArray.buffer], { type: responseData.mimeType || 'video/mp4' });
        console.log('Server-side MP4 blob size:', mp4Blob.size, 'bytes');

        const url = URL.createObjectURL(mp4Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clip-${clip.id}-${clip.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success(`Clip ${clip.id} downloaded via server!`, { id: `clip-${clip.id}` });
        return;
      }

      // Fetch the VOD content for client-side ffmpeg processing
      toast.loading(`Processing with FFmpeg...`, { id: `clip-${clip.id}` });

      console.log('ffmpeg: fetching VOD for client-side processing');
      const ffmpeg = ffmpegRef.current;
      const vodResponse = await fetch(vodSourceUrl);

      if (!vodResponse.ok) {
        throw new Error(`Failed to fetch VOD: ${vodResponse.status}`);
      }

      // Check MIME type
      const contentType = vodResponse.headers.get('content-type') || '';
      console.log('VOD Content-Type:', contentType);

      if (
        !contentType.includes('video') &&
        !contentType.includes('application/vnd.apple.mpegurl') &&
        !contentType.includes('application/octet-stream')
      ) {
        throw new Error(`Input is not a video — upload MP4 or provide a valid VOD. Received: ${contentType}`);
      }

      const vodData_buffer = await vodResponse.arrayBuffer();
      console.log('VOD buffer size:', vodData_buffer.byteLength, 'bytes');

      console.log('ffmpeg: writeFile input.mp4');
      await ffmpeg.writeFile('input.mp4', new Uint8Array(vodData_buffer));

      console.log('ffmpeg: run start');
      await ffmpeg.exec([
        '-ss',
        startSeconds.toString(),
        '-i',
        'input.mp4',
        '-t',
        duration.toString(),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        'output.mp4',
      ]);
      console.log('ffmpeg: run complete');

      console.log('ffmpeg: readFile output.mp4');
      const data = (await ffmpeg.readFile('output.mp4')) as Uint8Array;
      const mp4Blob = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });

      console.log('Generated MP4 blob size:', mp4Blob.size, 'bytes');

      // Clean up FFmpeg files
      await ffmpeg.deleteFile('input.mp4');
      await ffmpeg.deleteFile('output.mp4');

      // Trigger download
      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clip-${clip.id}-${clip.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded!`, { id: `clip-${clip.id}` });
    } catch (error) {
      console.error('Download error:', error);
      toast.error(
        `Failed to download clip: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: `clip-${clip.id}` },
      );
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  const handleDownloadAll = async () => {
    if (!isFFmpegLoaded) {
      toast.error('Video processor not ready yet, please wait...');
      return;
    }

    toast.info(`Processing ${clips.length} clips... This may take several minutes.`);
    
    for (const clip of clips) {
      await handleDownloadClip(clip);
    }
  };

  if (!vodUrl || !vodData) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="force-server-processing"
                  checked={useServerProcessing}
                  onCheckedChange={(checked) => setUseServerProcessing(!!checked)}
                />
                <Label
                  htmlFor="force-server-processing"
                  className="text-xs md:text-sm text-muted-foreground"
                >
                  Force server-side processing
                </Label>
              </div>
              <Button
                onClick={handleDownloadAll}
                className="gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
              >
                <Download className="w-4 h-4" />
                Download All as ZIP
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        {/* Success Message */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 mb-4">
            <TrendingUp className="w-4 h-4 text-success" />
            <span className="text-sm font-medium text-success">Generation Complete</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-foreground">
            {clips.length} Viral Clips Ready
          </h1>
          <p className="text-lg text-muted-foreground mb-2">
            Generated from: {vodData.title}
          </p>
          <p className="text-sm text-muted-foreground">
            Duration: {vodData.duration} • {vodData.userName}
          </p>
        </div>

        {/* Clips Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, index) => (
            <div
              key={clip.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-all group animate-fade-in"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              {/* Thumbnail */}
              <div className="relative aspect-[9/16] overflow-hidden bg-muted">
                <img
                  src={vodData.thumbnail.replace('%{width}', '400').replace('%{height}', '700')}
                  alt={clip.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                
                {/* Time Range Badge */}
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm flex items-center gap-1">
                  <Clock className="w-3 h-3 text-foreground" />
                  <span className="text-xs font-medium text-foreground">{clip.formattedTime}</span>
                </div>

                {/* Viral Score Badge */}
                <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-primary/20 backdrop-blur-sm border border-primary/30 flex items-center gap-1">
                  <Star className="w-3 h-3 text-primary fill-primary" />
                  <span className="text-xs font-bold text-primary">{clip.viralScore}</span>
                </div>

                {/* Duration Overlay */}
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded-md bg-background/90 backdrop-blur-sm">
                  <span className="text-xs font-bold text-foreground">{clip.duration}s</span>
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="font-semibold text-foreground mb-1 line-clamp-1">
                  {clip.title}
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {clip.formattedTime} • {clip.duration} seconds
                </p>
                <Button
                  onClick={() => handleDownloadClip(clip)}
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90 download-btn"
                  size="sm"
                  disabled={
                    downloadingClips.has(clip.id) ||
                    (!isFFmpegLoaded && !useServerProcessing)
                  }
                >
                  <Download className="w-4 h-4" />
                  {downloadingClips.has(clip.id)
                    ? 'Processing...'
                    : !isFFmpegLoaded && !useServerProcessing
                      ? `Loading processor (${ffmpegLoadSeconds}s/30s)…`
                      : useServerProcessing && !isFFmpegLoaded
                        ? 'Download via server'
                        : 'Download Clip'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Results;
