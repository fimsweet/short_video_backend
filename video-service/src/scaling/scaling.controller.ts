// ============================================
// SCALING CONTROLLER
// ============================================
// REST API endpoints for monitoring and manual control
// of the AWS Batch auto-scaling system
// ============================================

import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { BatchScalingService } from '../config/batch-scaling.service';
import type { ScalingMetrics } from '../config/batch-scaling.service';

@Controller('scaling')
export class ScalingController {
  constructor(private readonly batchScalingService: BatchScalingService) {}

  // ============================================
  // GET /scaling/metrics
  // ============================================
  // Returns current auto-scaling metrics
  // Used by monitoring dashboards (Grafana, CloudWatch)
  // ============================================
  @Get('metrics')
  getMetrics(): ScalingMetrics {
    return this.batchScalingService.getMetrics();
  }

  // ============================================
  // GET /scaling/status
  // ============================================
  // Human-readable status for debugging
  // ============================================
  @Get('status')
  async getStatus() {
    const metrics = this.batchScalingService.getMetrics();
    return {
      success: true,
      autoScaling: {
        enabled: metrics.isEnabled,
        provider: 'AWS Batch',
      },
      queue: {
        depth: metrics.queueDepth,
        lastChecked: metrics.lastCheckedAt,
      },
      workers: {
        batchRunning: metrics.batchJobsRunning,
        batchPending: metrics.batchJobsPending,
        totalActive: metrics.activeWorkers,
      },
      history: {
        totalJobsSubmitted: metrics.totalJobsSubmitted,
        lastAction: metrics.lastScaleAction,
      },
    };
  }

  // ============================================
  // POST /scaling/trigger
  // ============================================
  // Manually trigger scaling (for testing/emergency)
  // Body: { "workerCount": 2 }
  // ============================================
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async triggerScale(@Body() body?: { workerCount?: number }) {
    const result = await this.batchScalingService.manualTriggerScale(
      body?.workerCount || 1,
    );
    return {
      success: true,
      message: `Triggered ${result.jobIds.length} AWS Batch worker(s)`,
      jobIds: result.jobIds,
    };
  }

  // ============================================
  // POST /scaling/check
  // ============================================
  // Force an immediate queue check and scaling decision
  // Useful for testing without waiting for the cron
  // ============================================
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async forceCheck() {
    await this.batchScalingService.checkQueueAndScale();
    const metrics = this.batchScalingService.getMetrics();
    return {
      success: true,
      message: 'Queue checked and scaling decision made',
      metrics,
    };
  }
}
