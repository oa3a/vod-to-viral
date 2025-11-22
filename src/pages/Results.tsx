import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vodUrl = location.state?.vodUrl;
  const vodData = location.state?.vodData;

  // Use real clips from Twitch VOD data
  const clips = vodData?.clips || [];

  const handleDownloadClip = (clip: any) => {
    toast.info(
      `Download functionality coming soon! This will download the clip from ${clip.formattedTime} (${clip.duration}s).`,
      { duration: 4000 }
    );
  };

  const handleDownloadAll = () => {
    toast.info(
      'Bulk download coming soon! In production, this will process and download all clips as .mp4 files.',
      { duration: 4000 }
    );
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
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
            <Button
              onClick={handleDownloadAll}
              className="gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
            >
              <Download className="w-4 h-4" />
              Download All as ZIP
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
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                  size="sm"
                >
                  <Download className="w-4 h-4" />
                  Download Clip
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
