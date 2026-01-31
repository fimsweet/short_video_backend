import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportReason, ReportStatus } from './report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  async createReport(
    reporterId: string,
    reportedUserId: string,
    reason: ReportReason,
    description?: string,
  ): Promise<Report> {
    // Check if user already reported this person recently (within 24 hours)
    const recentReport = await this.reportRepository.findOne({
      where: {
        reporterId,
        reportedUserId,
        status: ReportStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    if (recentReport) {
      const hoursSinceLastReport = 
        (Date.now() - new Date(recentReport.createdAt).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastReport < 24) {
        throw new BadRequestException(
          'Bạn đã báo cáo người này gần đây. Vui lòng đợi 24 giờ trước khi báo cáo lại.',
        );
      }
    }

    const report = this.reportRepository.create({
      reporterId,
      reportedUserId,
      reason,
      description,
      status: ReportStatus.PENDING,
    });

    return this.reportRepository.save(report);
  }

  async getReportsByUser(reporterId: string): Promise<Report[]> {
    return this.reportRepository.find({
      where: { reporterId },
      order: { createdAt: 'DESC' },
    });
  }

  async getReportsForUser(reportedUserId: string): Promise<Report[]> {
    return this.reportRepository.find({
      where: { reportedUserId },
      order: { createdAt: 'DESC' },
    });
  }

  async getPendingReports(): Promise<Report[]> {
    return this.reportRepository.find({
      where: { status: ReportStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  async updateReportStatus(
    reportId: string,
    status: ReportStatus,
    reviewedBy: string,
    reviewNotes?: string,
  ): Promise<Report> {
    const report = await this.reportRepository.findOne({ where: { id: reportId } });
    
    if (!report) {
      throw new BadRequestException('Report not found');
    }

    report.status = status;
    report.reviewedBy = reviewedBy;
    report.reviewNotes = reviewNotes ?? '';

    return this.reportRepository.save(report);
  }

  async getReportCount(reportedUserId: string): Promise<number> {
    return this.reportRepository.count({
      where: { reportedUserId },
    });
  }
}
