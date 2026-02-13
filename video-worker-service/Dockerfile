# ============================================
# VIDEO WORKER SERVICE - Production Dockerfile
# ============================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install FFmpeg and other required packages
RUN apk add --no-cache \
    dumb-init \
    ffmpeg \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create temp directories for video processing
# Tạo TẤT CẢ thư mục worker có thể cần (cả trên EC2 lẫn AWS Batch)
RUN mkdir -p uploads/raw_videos uploads/processed_videos processed_videos temp \
    && chown -R nestjs:nodejs uploads processed_videos temp

# Switch to non-root user
USER nestjs

# Environment variables for FFmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# No port exposed - this is a worker service (no HTTP)

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
