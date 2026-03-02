import { Controller, Get } from '@nestjs/common';

/**
 * Health Check Controller for Kubernetes
 * 
 * K8s uses two types of probes:
 * - Liveness: Checks if the pod is alive -> restarts on failure
 * - Readiness: Checks if the pod is ready to receive traffic
 * 
 * For the worker service, both probes check:
 * 1. Process is running (implicit - no response means it's down)
 * 2. RabbitMQ connection (optional - worker auto-reconnects)
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'video-worker-service',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  liveness() {
    // K8s Liveness probe - only checks if the process is alive
    return { status: 'ok' };
  }

  @Get('ready')
  readiness() {
    // K8s Readiness probe - could add RabbitMQ connection check
    // Since the worker auto-reconnects, a basic process check suffices
    return { status: 'ok' };
  }
}
