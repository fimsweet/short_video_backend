import { Controller, Get } from '@nestjs/common';

/**
 * Health Check Controller for Kubernetes
 * 
 * K8s sử dụng 2 loại probe:
 * - Liveness: Kiểm tra pod còn sống không → restart nếu fail
 * - Readiness: Kiểm tra pod sẵn sàng nhận traffic không
 * 
 * Với worker service, cả 2 đều cần check:
 * 1. Process đang chạy (implicit - nếu không thì không response được)
 * 2. RabbitMQ connection (optional - worker sẽ tự reconnect)
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
    // K8s Liveness probe - chỉ cần process còn sống
    return { status: 'ok' };
  }

  @Get('ready')
  readiness() {
    // K8s Readiness probe - có thể thêm check RabbitMQ connection
    // Nhưng vì worker tự reconnect, ta chỉ cần check process
    return { status: 'ok' };
  }
}
