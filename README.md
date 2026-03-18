# Short Video Backend

Backend system for the Scalable Short Video Application thesis project. The system follows a microservices architecture built with NestJS (Node.js), deployed on AWS EC2 with Docker Compose, and supports auto-scaling video processing via AWS Batch.

---

## System Overview

The backend consists of three independent NestJS microservices, an Nginx API Gateway, and supporting infrastructure services:

- **user-service** (port 3000) — Handles authentication (JWT, Google OAuth, Firebase Phone OTP, 2FA/TOTP), user profiles, follow/unfollow, sessions, activity history, push notification registration, and user reports.
- **video-service** (port 3002) — Handles video upload (single file and chunked), video feed, comments, likes, saved videos, real-time chat (Socket.IO WebSocket), notifications, shares, categories, watch history, Elasticsearch-based search, creator analytics, and recommendation engine. Also manages AWS Batch auto-scaling for video workers.
- **video-worker-service** (port 3003) — Consumes video processing jobs from RabbitMQ and performs FFmpeg-based HLS adaptive bitrate encoding (720p, 480p, 360p), thumbnail generation, AI-based category prediction (AWS Rekognition + Google Gemini), and uploads processed files to AWS S3. Supports both local (EC2/K8s) mode and AWS Batch mode.
- **api-gateway** (port 80) — Nginx reverse proxy that routes all client requests to the appropriate service by URL path prefix. Includes rate limiting, WebSocket proxying, gzip compression, and file upload size limits.

Supporting infrastructure (managed via Docker Compose):
- MySQL 8.0 — Primary relational database for both user-service and video-service.
- Redis 7 — Caching layer for API responses, sessions, and rate limiting.
- RabbitMQ 3.11 — Message queue for asynchronous video processing jobs with dead-letter queue support.
- Elasticsearch 8.11 — Full-text search engine for video and user search.

External cloud services:
- AWS S3 — Storage for raw video files, processed HLS segments, and thumbnails.
- AWS CloudFront — CDN for low-latency video and image delivery.
- AWS Batch (Spot Instances) — Auto-scaling compute for video processing workers.
- AWS Rekognition — AI-based video content label detection.
- Google Gemini API — AI-based video category prediction from detected labels.
- Firebase Admin SDK — Phone number OTP verification and push notification delivery (FCM).
- Gmail SMTP (Nodemailer) — Email OTP delivery for account linking and password reset.

---

## API Gateway Routing

The Nginx gateway on port 80 routes requests by path prefix:

Routes to user-service (port 3000):
- `/auth/*` — Authentication endpoints (login, register, OAuth, OTP, 2FA)
- `/users/*` — User profile CRUD, avatar upload, search users
- `/follows/*` — Follow, unfollow, follower/following lists
- `/sessions/*` — Device session management
- `/reports/*` — User reporting
- `/activity-history/*` — Login/activity history
- `/push/*` — Push notification diagnostics

Routes to video-service (port 3002):
- `/videos/*` — Video CRUD, upload, feed, chunked upload
- `/comments/*` — Comment CRUD with nested replies
- `/likes/*` — Like/unlike videos
- `/saved-videos/*` — Save/unsave bookmarks
- `/messages/*` — Chat messages
- `/notifications/*` — In-app notifications
- `/analytics/*` — Creator analytics
- `/shares/*` — Video sharing
- `/recommendation/*` — Video recommendations
- `/categories/*` — Video categories
- `/watch-history/*` — Watch time tracking
- `/socket.io/*` — WebSocket (Socket.IO) for real-time chat

---

## Prerequisites

Before running the system, ensure the following are installed:

- Node.js 20+ and npm
- Docker and Docker Compose
- FFmpeg (required on the machine running video-worker-service; included in Docker image)
- Git

For AWS deployment (optional):
- AWS CLI configured with appropriate IAM credentials
- An AWS ECR repository for pushing Docker images
- An AWS EC2 instance (recommended: t3.large or larger)

---

## Project Structure

```
short_video_backend/
  api-gateway/            — Nginx reverse proxy configuration
    nginx.conf
    proxy_params.conf
    Dockerfile
  user-service/           — Authentication and user management service
    src/
      auth/               — JWT, Google OAuth, Firebase Phone, TOTP 2FA
      users/              — User CRUD, avatar upload, profile
      follows/            — Social graph (follow/unfollow)
      sessions/           — Device session tracking
      config/             — Database, Redis, email, multer configs
      ...
    Dockerfile
  video-service/          — Video and social interaction service
    src/
      videos/             — Video upload, feed, chunked upload
      comments/           — Nested comments with likes
      likes/              — Video likes
      messages/           — Real-time chat (Socket.IO)
      notifications/      — Push and in-app notifications
      search/             — Elasticsearch integration
      recommendation/     — Content recommendation engine
      watch-history/      — Watch time tracking for recommendations
      analytics/          — Creator analytics
      scaling/            — AWS Batch auto-scaling trigger
      config/             — Database, Redis, S3, batch-scaling configs
      ...
    Dockerfile
  video-worker-service/   — Video processing worker
    src/
      processor/          — FFmpeg HLS encoding, RabbitMQ consumer
      config/             — Database, S3 storage, AI analysis configs
      health/             — K8s health check endpoints
    Dockerfile
  k8s/                    — Kubernetes deployment manifests
  k6-tests/               — Load testing scripts (k6)
  docker-compose.yaml     — Local development infrastructure
  docker-compose.prod.yaml — Production deployment (AWS EC2)
  aws-batch-setup.yaml    — CloudFormation template for AWS Batch
```

---

## Running Locally (Development)

### Step 1 — Clone the repository

```bash
git clone <repository-url>
cd short_video_backend
```

### Step 2 — Start infrastructure services

Start MySQL, Redis, RabbitMQ, and Elasticsearch using Docker Compose:

```bash
docker compose up -d
```

This starts:
- MySQL on port 3306
- Redis on port 6379
- RabbitMQ on port 5672 (management UI at http://localhost:15672, user/password)
- Elasticsearch on port 9200

### Step 3 — Create environment files

Each service reads configuration from a `.env` file in its own directory. Create the following files:

**user-service/.env**

```
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=admin
DB_PASSWORD=password
DB_NAME=short_video_db
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-jwt-secret-key-here
GOOGLE_CLIENT_ID=your-google-oauth-client-id
EMAIL_USER=your-gmail-address@gmail.com
EMAIL_APP_PASSWORD=your-gmail-app-password
GEMINI_API_KEY=your-google-gemini-api-key
VIDEO_SERVICE_URL=http://localhost:3002
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
```

**video-service/.env**

```
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=admin
DB_PASSWORD=password
DB_NAME=short_video_db
REDIS_HOST=localhost
REDIS_PORT=6379
RABBITMQ_URL=amqp://user:password@localhost:5672
RABBITMQ_QUEUE=video_processing_queue
ELASTICSEARCH_NODE=http://localhost:9200
USER_SERVICE_URL=http://localhost:3000
GEMINI_API_KEY=your-google-gemini-api-key
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=your-s3-bucket-name
CLOUDFRONT_URL=https://your-cloudfront-distribution-url
AWS_BATCH_JOB_QUEUE=your-batch-job-queue-arn
AWS_BATCH_JOB_DEFINITION=your-batch-job-definition-arn
```

**video-worker-service/.env**

```
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=admin
DB_PASSWORD=password
DB_NAME=short_video_db
RABBITMQ_URL=amqp://user:password@localhost:5672
RABBITMQ_QUEUE=video_processing_queue
VIDEO_SERVICE_URL=http://localhost:3002
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=your-s3-bucket-name
CLOUDFRONT_URL=https://your-cloudfront-distribution-url
GEMINI_API_KEY=your-google-gemini-api-key
```

Notes on obtaining these keys:
- `JWT_SECRET` — Any random string used to sign JWT tokens. Generate one with `openssl rand -hex 32`.
- `GOOGLE_CLIENT_ID` — Create an OAuth 2.0 Client ID in Google Cloud Console > APIs & Services > Credentials.
- `EMAIL_USER` and `EMAIL_APP_PASSWORD` — A Gmail account with an App Password generated (Google Account > Security > 2-Step Verification > App passwords).
- `GEMINI_API_KEY` — Obtain from Google AI Studio (https://aistudio.google.com/).
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — Create an IAM user in AWS Console with S3, Batch, and Rekognition permissions.
- `AWS_S3_BUCKET` — Create an S3 bucket in the target region.
- `CLOUDFRONT_URL` — Create a CloudFront distribution pointing to the S3 bucket.
- `FIREBASE_SERVICE_ACCOUNT_PATH` — Download the service account JSON from Firebase Console > Project Settings > Service accounts. Place it as `user-service/firebase-service-account.json`.
- `AWS_BATCH_JOB_QUEUE` and `AWS_BATCH_JOB_DEFINITION` — These are output from the AWS Batch CloudFormation stack (see the AWS Batch Setup section below). Leave empty for local development if not using Batch.

### Step 4 — Install dependencies

```bash
cd user-service && npm install && cd ..
cd video-service && npm install && cd ..
cd video-worker-service && npm install && cd ..
```

### Step 5 — Start the services

Open three separate terminal windows and run each service in development mode:

Terminal 1 — user-service:
```bash
cd user-service
npm run start:dev
```

Terminal 2 — video-service:
```bash
cd video-service
npm run start:dev
```

Terminal 3 — video-worker-service:
```bash
cd video-worker-service
npm run start:dev
```

The services will start on their respective ports (3000, 3002, 3003). Database tables are created automatically via TypeORM synchronize on first startup.

### Step 6 — Verify the services

- user-service health: http://localhost:3000/health
- video-service health: http://localhost:3002/health
- video-worker-service health: http://localhost:3003/health
- RabbitMQ management: http://localhost:15672 (user: user, password: password)
- Elasticsearch: http://localhost:9200

### Step 7 — (Optional) Start the API Gateway locally

If you want to test routing through Nginx locally:

```bash
docker compose --profile gateway up -d api-gateway
```

All requests can then go through http://localhost:80 instead of directly to individual service ports.

---

## Running Tests

Each service has unit tests using Jest:

```bash
cd user-service && npm test
cd video-service && npm test
cd video-worker-service && npm test
```

For test coverage reports:

```bash
cd user-service && npm run test:cov
cd video-service && npm run test:cov
cd video-worker-service && npm run test:cov
```

Load testing scripts (k6) are available in the `k6-tests/` directory:

```bash
k6 run k6-tests/load_test.js
k6 run k6-tests/stress_test.js
k6 run k6-tests/security_test.js
```

---

## Production Deployment (AWS EC2 with Docker Compose)

### Step 1 — Provision an EC2 instance

- Launch an EC2 instance (recommended: t3.large, 2 vCPU, 8 GB RAM).
- Attach an Elastic IP for a static public address.
- Attach an additional EBS volume (100 GB) mounted at `/data` for persistent storage.
- Open inbound ports in the Security Group: 80 (HTTP), 443 (HTTPS), 22 (SSH).

### Step 2 — Install Docker on the EC2 instance

```bash
sudo yum update -y
sudo yum install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### Step 3 — Clone and configure

```bash
git clone <repository-url>
cd short_video_backend
```

Create `.env` files for each service as described in the local development section above, but update:
- `DB_HOST=mysql` (Docker internal hostname instead of localhost)
- `REDIS_HOST=redis`
- `RABBITMQ_URL=amqp://user:password@rabbitmq:5672`
- `ELASTICSEARCH_NODE=http://elasticsearch:9200`
- `USER_SERVICE_URL=http://user-service:3000` (for video-service)
- `VIDEO_SERVICE_URL=http://video-service:3002` (for video-worker-service)

### Step 4 — Create the data directory

```bash
sudo mkdir -p /data/mysql /data/redis /data/rabbitmq /data/elasticsearch /data/uploads
sudo chown -R 1000:1000 /data
```

### Step 5 — Build and start all services

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

This starts all infrastructure services (MySQL, Redis, RabbitMQ, Elasticsearch), all application services (user-service, video-service, video-worker), and the Nginx API Gateway on port 80.

### Step 6 — Verify deployment

```bash
curl http://localhost/health
curl http://localhost/health/user-service
curl http://localhost/health/video-service
```

### Step 7 — View logs

```bash
docker compose -f docker-compose.prod.yaml logs -f user-service
docker compose -f docker-compose.prod.yaml logs -f video-service
docker compose -f docker-compose.prod.yaml logs -f video-worker
```

---

## AWS Batch Setup (Auto-Scaling Video Processing)

The system uses AWS Batch to automatically scale video processing workers when the RabbitMQ queue grows. The video-service monitors the queue depth and submits Batch jobs when backlog exceeds the local worker capacity.

### Overview of what AWS Batch provides

- A Compute Environment using EC2 Spot Instances (c5.large, c5.xlarge, m5.large) that scales from 0 to a configurable maximum number of vCPUs.
- A Job Queue where the video-service submits processing jobs.
- A Job Definition specifying the Docker container (video-worker-service image), resource requirements (2 vCPU, 3 GB RAM), environment variables, and retry strategy.
- When there are no jobs, the environment scales to zero instances (no cost).

### Step 1 — Push the worker Docker image to ECR

```bash
# Create an ECR repository
aws ecr create-repository --repository-name short-video-worker --region ap-southeast-1

# Authenticate Docker to ECR
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com

# Build and push
cd video-worker-service
docker build -t short-video-worker .
docker tag short-video-worker:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/short-video-worker:latest
docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/short-video-worker:latest
```

### Step 2 — Deploy the CloudFormation stack

The file `aws-batch-setup.yaml` is a CloudFormation template that creates all necessary AWS Batch resources (compute environment, job queue, job definition, IAM roles, security groups, CloudWatch log group).

```bash
aws cloudformation create-stack \
  --stack-name short-video-batch \
  --template-body file://aws-batch-setup.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxx \
    ParameterKey=SubnetIds,ParameterValue="subnet-xxx1,subnet-xxx2" \
    ParameterKey=ECRImageUri,ParameterValue=<account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/short-video-worker:latest \
    ParameterKey=RabbitMQUrl,ParameterValue="amqp://user:password@<ec2-private-ip>:5672" \
    ParameterKey=DBHost,ParameterValue=<ec2-private-ip> \
    ParameterKey=DBPassword,ParameterValue=<db-password> \
    ParameterKey=S3Bucket,ParameterValue=<your-s3-bucket> \
    ParameterKey=AWSAccessKeyId,ParameterValue=<access-key> \
    ParameterKey=AWSSecretAccessKey,ParameterValue=<secret-key> \
    ParameterKey=VideoServiceUrl,ParameterValue="http://<ec2-private-ip>:3002" \
    ParameterKey=CloudFrontUrl,ParameterValue="https://your-cloudfront-url"
```

### Step 3 — Retrieve outputs and update video-service .env

After the stack is created, retrieve the Job Queue ARN and Job Definition ARN:

```bash
aws cloudformation describe-stacks --stack-name short-video-batch --query "Stacks[0].Outputs"
```

Add these values to `video-service/.env`:

```
AWS_BATCH_JOB_QUEUE=arn:aws:batch:ap-southeast-1:xxxx:job-queue/short-video-processing-queue
AWS_BATCH_JOB_DEFINITION=arn:aws:batch:ap-southeast-1:xxxx:job-definition/short-video-worker:1
```

Then restart video-service for the changes to take effect.

### How auto-scaling works

- The video-service periodically monitors the RabbitMQ queue depth (number of pending video processing jobs).
- When pending jobs exceed the local worker capacity, the batch-scaling service submits AWS Batch jobs.
- Each Batch job runs a video-worker-service container in `BATCH_MODE=true`, which processes jobs from the same RabbitMQ queue.
- Batch workers automatically exit when idle (`AUTO_EXIT_WHEN_IDLE=true`, `IDLE_TIMEOUT_SECONDS=60`).
- AWS Batch provisions EC2 Spot Instances (up to 60% of on-demand price) and terminates them when no jobs remain.
- The worker handles graceful shutdown via SIGTERM to avoid corrupting in-progress video processing.

---

## Video Processing Pipeline

When a video is uploaded, the following pipeline executes:

- The client uploads the raw video file to video-service (single or chunked upload).
- video-service stores the raw file locally (or on S3 in production), creates a database record with status `PROCESSING`, and publishes a job to the RabbitMQ `video_processing_queue`.
- video-worker-service (local or Batch) picks up the job:
  - Downloads the raw video from S3 if not available locally.
  - Probes the video for metadata (duration, resolution, aspect ratio) using FFmpeg.
  - Encodes the video into HLS adaptive bitrate format with three quality variants (720p, 480p, 360p).
  - Generates a thumbnail image from the video.
  - Runs AI analysis: AWS Rekognition detects content labels, then Google Gemini maps labels to predefined categories.
  - Uploads all processed files (HLS segments, master playlist, thumbnail) to S3.
  - Updates the database record with the HLS URL, thumbnail URL, aspect ratio, duration, and status `READY`.
  - Notifies video-service to invalidate the cache.
- The client can then stream the video via the CloudFront CDN URL.

---

## Key Environment Variables Reference

Common across all services:
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` — MySQL connection
- `NODE_ENV` — Set to `production` for production deployment

user-service specific:
- `REDIS_HOST`, `REDIS_PORT` — Redis connection
- `JWT_SECRET` — Secret key for signing JWT access tokens
- `GOOGLE_CLIENT_ID` — Google OAuth 2.0 client ID
- `EMAIL_USER`, `EMAIL_APP_PASSWORD` — Gmail SMTP credentials for sending OTP emails
- `GEMINI_API_KEY` — Google Gemini API key for AI-powered user bio moderation
- `VIDEO_SERVICE_URL` — Internal URL of video-service for cross-service calls
- `FIREBASE_SERVICE_ACCOUNT_PATH` — Path to Firebase service account JSON file

video-service specific:
- `REDIS_HOST`, `REDIS_PORT` — Redis connection
- `RABBITMQ_URL` — RabbitMQ AMQP connection string
- `RABBITMQ_QUEUE` — Queue name for video processing jobs
- `ELASTICSEARCH_NODE` — Elasticsearch connection URL
- `USER_SERVICE_URL` — Internal URL of user-service for cross-service calls
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — AWS credentials
- `AWS_S3_BUCKET` — S3 bucket name for video storage
- `CLOUDFRONT_URL` — CloudFront distribution URL
- `AWS_BATCH_JOB_QUEUE`, `AWS_BATCH_JOB_DEFINITION` — AWS Batch ARNs for auto-scaling
- `GEMINI_API_KEY` — Google Gemini API key for AI chat features

video-worker-service specific:
- `RABBITMQ_URL`, `RABBITMQ_QUEUE` — RabbitMQ connection
- `VIDEO_SERVICE_URL` — URL to notify video-service on processing completion
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` — AWS S3 credentials
- `CLOUDFRONT_URL` — CloudFront URL for generating public video URLs
- `GEMINI_API_KEY` — Google Gemini API key for AI category prediction
- `BATCH_MODE` — Set to `true` when running as an AWS Batch job
- `AUTO_EXIT_WHEN_IDLE` — Set to `true` for Batch workers to auto-terminate
- `IDLE_TIMEOUT_SECONDS` — Seconds to wait before exiting when idle (default: 60)
- `WORKER_CONCURRENCY` — Number of videos to process concurrently (default: 1)
- `UPLOAD_ROOT_PATH` — Root path for file operations inside the container
- `PROCESSED_VIDEOS_PATH` — Path for processed video output
