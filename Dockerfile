# Use Node.js 18 LTS
FROM node:18-slim

# Install FFmpeg and yt-dlp
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY railway-package.json package.json
COPY railway-server.js server.js

# Install dependencies
RUN npm install --production

# Create temp directory
RUN mkdir -p /app/temp

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
