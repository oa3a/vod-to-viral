# Use Node.js LTS base image
FROM node:18-slim

# Install system FFmpeg and yt-dlp (no ffmpeg-static)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates && \
    pip3 install --no-cache-dir yt-dlp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy server package manifest and install production dependencies only
COPY railway-package.json package.json
RUN npm install --omit=dev

# Copy server entrypoint
COPY railway-server.js server.js

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
