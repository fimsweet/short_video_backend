#!/bin/bash

# ============================================
# AWS BATCH DEPLOYMENT SCRIPT
# ============================================
# This script sets up AWS Batch for auto-scaling
# video processing workers.
#
# PREREQUISITES:
# 1. AWS CLI installed and configured
# 2. Docker installed
# 3. ECR repository created
#
# USAGE:
#   chmod +x scripts/deploy-batch.sh
#   ./scripts/deploy-batch.sh
# ============================================

set -e

# ============================================
# CONFIGURATION - Edit these values
# ============================================
AWS_REGION="ap-southeast-1"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO_NAME="short-video-worker"
STACK_NAME="short-video-batch"

# These should match your EC2 setup
VPC_ID="vpc-xxxxxxxxx"           # Your VPC ID
SUBNET_IDS="subnet-xxxxxxxxx"    # Your subnet IDs (comma-separated)

# Database config (same as docker-compose.prod.yaml)
DB_HOST="mysql"                  # Or your RDS endpoint
DB_PASSWORD="your-db-password"

# S3 config
S3_BUCKET="your-video-bucket"

# RabbitMQ config (accessible from Batch instances)
RABBITMQ_URL="amqp://user:password@your-rabbitmq-host:5672"

# Video service URL (accessible from Batch instances)
# Use API Gateway URL (port 80) instead of direct video-service port
VIDEO_SERVICE_URL="http://18.138.223.226"

echo "============================================"
echo "  AWS BATCH DEPLOYMENT"
echo "============================================"
echo "  Region:  ${AWS_REGION}"
echo "  Account: ${AWS_ACCOUNT_ID}"
echo "============================================"

# ============================================
# STEP 1: Create ECR Repository (if not exists)
# ============================================
echo ""
echo "[STEP 1] Creating ECR Repository..."
aws ecr describe-repositories --repository-names ${ECR_REPO_NAME} --region ${AWS_REGION} 2>/dev/null || \
aws ecr create-repository --repository-name ${ECR_REPO_NAME} --region ${AWS_REGION}

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
echo "  ECR URI: ${ECR_URI}"

# ============================================
# STEP 2: Build and Push Docker Image
# ============================================
echo ""
echo "[STEP 2] Building and pushing Docker image..."

# Login to ECR
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build the video-worker image
docker build -t ${ECR_REPO_NAME}:latest ./video-worker-service/

# Tag and push
docker tag ${ECR_REPO_NAME}:latest ${ECR_URI}:latest
docker push ${ECR_URI}:latest

echo "  Image pushed: ${ECR_URI}:latest"

# ============================================
# STEP 3: Deploy CloudFormation Stack
# ============================================
echo ""
echo "[STEP 3] Deploying CloudFormation stack..."

aws cloudformation deploy \
  --template-file aws-batch-setup.yaml \
  --stack-name ${STACK_NAME} \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ${AWS_REGION} \
  --parameter-overrides \
    VpcId=${VPC_ID} \
    SubnetIds=${SUBNET_IDS} \
    ECRImageUri=${ECR_URI}:latest \
    RabbitMQUrl="${RABBITMQ_URL}" \
    DBHost=${DB_HOST} \
    DBPassword="${DB_PASSWORD}" \
    S3Bucket=${S3_BUCKET} \
    AWSRegion=${AWS_REGION} \
    VideoServiceUrl="${VIDEO_SERVICE_URL}" \
    AWSAccessKeyId=$(aws configure get aws_access_key_id) \
    AWSSecretAccessKey=$(aws configure get aws_secret_access_key)

# ============================================
# STEP 4: Get Outputs
# ============================================
echo ""
echo "[STEP 4] Getting CloudFormation outputs..."

JOB_QUEUE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query "Stacks[0].Outputs[?OutputKey=='JobQueueArn'].OutputValue" \
  --output text --region ${AWS_REGION})

JOB_DEF_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query "Stacks[0].Outputs[?OutputKey=='JobDefinitionArn'].OutputValue" \
  --output text --region ${AWS_REGION})

echo ""
echo "============================================"
echo "  DEPLOYMENT COMPLETE!"
echo "============================================"
echo ""
echo "  Add these to your video-service .env file:"
echo ""
echo "  AWS_BATCH_JOB_QUEUE=${JOB_QUEUE_ARN}"
echo "  AWS_BATCH_JOB_DEFINITION=${JOB_DEF_ARN}"
echo ""
echo "  Then restart video-service to enable auto-scaling."
echo ""
echo "  Monitor: GET http://your-ec2:3002/scaling/status"
echo "  Manual:  POST http://your-ec2:3002/scaling/trigger"
echo "============================================"
