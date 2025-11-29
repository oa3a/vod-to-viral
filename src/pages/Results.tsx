import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vodUrl = location.state?.vodUrl;
  const vodData = location.state?.vodData;

  const clips = vodData?.clips || [];
  const [downloadingClips, setDownloadingClips] = useState<Set<number>>(new Set());

  const handleDownloadClip = async (clip: any) => {
    if (downloadingClips.has(clip.id)) {
      toast.info("This clip is already being processed");
      return;
    }

    setDownloadingClips((prev) => new Set(prev).add(clip.id));

    try {
      toast.loading(`Preparing clip ${clip.id}...`, { id: `clip-${clip.id}` });

      // Get absolute URL for the VOD
      let absoluteVodUrl: string;

      // For testing, convert relative path to absolute URL
      if (vodData.vodId === "test" || !vodData.vodId) {
        // Use sample video with absolute URL
        const currentUrl = new URL(window.location.href);
        absoluteVodUrl = new URL("/assets/sample_vod.mp4", currentUrl.origin).toString();
        console.log("Using test video (absolute URL):", absoluteVodUrl);
      } else {
        // For real Twitch VODs, get the stream URL
        console.log("Fetching stream URL for VOD:", vodData.vodId);
        const { data: streamData, error: streamError } = await supabase.functions.invoke("get-vod-stream", {
          body: { vodId: vodData.vodId },
        });

        if (streamError || !streamData?.streamUrl) {
          console.error("Failed to get stream URL:", streamError);
          throw new Error("Failed to get video stream URL");
        }

        absoluteVodUrl = streamData.streamUrl;
        console.log("Got stream URL from Twitch:", absoluteVodUrl);
      }

      // Validate URL is absolute
      if (!absoluteVodUrl.startsWith("http://") && !absoluteVodUrl.startsWith("https://")) {
        console.error("VOD URL is not absolute:", absoluteVodUrl);
        throw new Error(`Invalid VOD URL format: ${absoluteVodUrl}`);
      }

      console.log("Final absolute VOD URL:", absoluteVodUrl);

      const startSeconds = clip.startTime;
      const endSeconds = clip.endTime;

      console.log(`Clip ${clip.id}: Calling process-clip edge function`);
      console.log(`Parameters: vodUrl=${absoluteVodUrl}, start=${startSeconds}s, end=${endSeconds}s`);

      toast.loading(`Processing clip ${clip.id} on server...`, { id: `clip-${clip.id}` });

      // Call Supabase edge function which will call Railway
      // Direct fetch so we can receive ArrayBuffer (Supabase invoke does NOT support binary)
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-clip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          vodUrl: absoluteVodUrl,
          startTime: startSeconds,
          endTime: endSeconds,
        }),
      });

      // Handle failure
      if (!response.ok) {
        const errText = await response.text();
        console.error("Edge function error:", errText);
        throw new Error("Server failed to generate clip");
      }

      // Read MP4 as ArrayBuffer
      const buffer = await response.arrayBuffer();
      const mp4Blob = new Blob([buffer], { type: "video/mp4" });

      if (error) {
        console.error("Edge function error:", error);
        throw new Error(error.message || "Failed to process clip");
      }

      // Check if we got a Blob/ArrayBuffer response
      if (!data) {
        console.error("No data received from edge function");
        throw new Error("No data received from server");
      }

      console.log("Received data type:", typeof data);
      console.log("Data instanceof Blob:", data instanceof Blob);
      console.log("Data instanceof ArrayBuffer:", data instanceof ArrayBuffer);

      let mp4Blob: Blob;

      // Handle different response types
      if (data instanceof Blob) {
        mp4Blob = data;
      } else if (data instanceof ArrayBuffer) {
        mp4Blob = new Blob([data], { type: "video/mp4" });
      } else if (typeof data === "object" && data.error) {
        throw new Error(data.error);
      } else {
        console.error("Unexpected data format:", data);
        throw new Error("Invalid response format from server");
      }

      console.log("MP4 blob size:", mp4Blob.size, "bytes");

      if (mp4Blob.size === 0) {
        throw new Error("Received empty video file");
      }

      // Verify it's a video file by checking the first bytes
      const headerCheck = await mp4Blob.slice(0, 12).arrayBuffer();
      const headerView = new Uint8Array(headerCheck);
      const headerHex = Array.from(headerView)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      console.log("File header (first 12 bytes):", headerHex);

      // MP4 files should start with specific signatures
      const isMP4 =
        // ftyp box signature
        (headerView[4] === 0x66 && headerView[5] === 0x74 && headerView[6] === 0x79 && headerView[7] === 0x70) ||
        // Alternative: starts with size then ftyp
        (headerView[8] === 0x66 && headerView[9] === 0x74 && headerView[10] === 0x79 && headerView[11] === 0x70);

      if (!isMP4) {
        console.error("File does not appear to be a valid MP4");
        throw new Error("Downloaded file is not a valid MP4 video");
      }

      toast.loading(`Downloading clip ${clip.id}...`, { id: `clip-${clip.id}` });

      // Trigger download
      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clip-${clip.id}-${clip.title.replace(/[^a-z0-9]/gi, "_")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded successfully!`, { id: `clip-${clip.id}` });
    } catch (error) {
      console.error("Download error:", error);
      toast.error(`Failed to download clip: ${error instanceof Error ? error.message : "Unknown error"}`, {
        id: `clip-${clip.id}`,
      });
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  const handleDownloadAll = async () => {
    toast.info(`Processing ${clips.length} clips... This may take several minutes.`);

    for (const clip of clips) {
      await handleDownloadClip(clip);
      // Add small delay between downloads
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
            <Button
              onClick={handleDownloadAll}
              className="gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
            >
              <Download className="w-4 h-4" />
              Download All
            </Button>
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
          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-foreground">{clips.length} Viral Clips Ready</h1>
          <p className="text-lg text-muted-foreground mb-2">Generated from: {vodData.title}</p>
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
                  src={vodData.thumbnail.replace("%{width}", "400").replace("%{height}", "700")}
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
                <h3 className="font-semibold text-foreground mb-1 line-clamp-1">{clip.title}</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {clip.formattedTime} • {clip.duration} seconds
                </p>
                <Button
                  onClick={() => handleDownloadClip(clip)}
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                  size="sm"
                  disabled={downloadingClips.has(clip.id)}
                >
                  <Download className="w-4 h-4" />
                  {downloadingClips.has(clip.id) ? "Processing..." : "Download Clip"}
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
