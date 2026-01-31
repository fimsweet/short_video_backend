import { Controller, Post, Get, Put, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportReason, ReportStatus } from './report.entity';

class CreateReportDto {
  reporterId: string;
  reportedUserId: string;
  reason: ReportReason;
  description?: string;
}

class UpdateReportDto {
  status: ReportStatus;
  reviewedBy: string;
  reviewNotes?: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createReport(@Body() dto: CreateReportDto) {
    const report = await this.reportsService.createReport(
      dto.reporterId,
      dto.reportedUserId,
      dto.reason,
      dto.description,
    );
    
    return {
      success: true,
      message: 'Báo cáo đã được gửi thành công. Chúng tôi sẽ xem xét trong thời gian sớm nhất.',
      data: report,
    };
  }

  @Get('by-reporter/:reporterId')
  async getReportsByUser(@Param('reporterId') reporterId: string) {
    const reports = await this.reportsService.getReportsByUser(reporterId);
    return { success: true, data: reports };
  }

  @Get('for-user/:userId')
  async getReportsForUser(@Param('userId') userId: string) {
    const reports = await this.reportsService.getReportsForUser(userId);
    return { success: true, data: reports };
  }

  @Get('pending')
  async getPendingReports() {
    const reports = await this.reportsService.getPendingReports();
    return { success: true, data: reports };
  }

  @Get('count/:userId')
  async getReportCount(@Param('userId') userId: string) {
    const count = await this.reportsService.getReportCount(userId);
    return { success: true, data: { count } };
  }

  @Put(':reportId')
  async updateReportStatus(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    const report = await this.reportsService.updateReportStatus(
      reportId,
      dto.status,
      dto.reviewedBy,
      dto.reviewNotes,
    );
    return { success: true, data: report };
  }

  @Get('reasons')
  getReportReasons() {
    const reasons = [
      { id: ReportReason.SPAM, label: 'Spam', labelVi: 'Tin rác / Spam' },
      { id: ReportReason.HARASSMENT, label: 'Harassment', labelVi: 'Quấy rối' },
      { id: ReportReason.INAPPROPRIATE_CONTENT, label: 'Inappropriate Content', labelVi: 'Nội dung không phù hợp' },
      { id: ReportReason.FAKE_ACCOUNT, label: 'Fake Account', labelVi: 'Tài khoản giả mạo' },
      { id: ReportReason.SCAM, label: 'Scam', labelVi: 'Lừa đảo' },
      { id: ReportReason.VIOLENCE, label: 'Violence', labelVi: 'Bạo lực' },
      { id: ReportReason.HATE_SPEECH, label: 'Hate Speech', labelVi: 'Phát ngôn thù ghét' },
      { id: ReportReason.OTHER, label: 'Other', labelVi: 'Khác' },
    ];
    return { success: true, data: reasons };
  }
}
