import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportReason, ReportStatus, Report } from './report.entity';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: jest.Mocked<Partial<ReportsService>>;

  const mockReport: Partial<Report> = {
    id: 'uuid-1',
    reporterId: 'user-1',
    reportedUserId: 'user-2',
    reason: ReportReason.SPAM,
    status: ReportStatus.PENDING,
  };

  beforeEach(async () => {
    service = {
      createReport: jest.fn().mockResolvedValue(mockReport),
      getReportsByUser: jest.fn().mockResolvedValue([mockReport]),
      getReportsForUser: jest.fn().mockResolvedValue([mockReport]),
      getPendingReports: jest.fn().mockResolvedValue([mockReport]),
      getReportCount: jest.fn().mockResolvedValue(3),
      updateReportStatus: jest.fn().mockResolvedValue({ ...mockReport, status: ReportStatus.REVIEWED }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: service },
      ],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createReport', () => {
    it('should create a report and return success', async () => {
      const result = await controller.createReport({
        reporterId: 'user-1',
        reportedUserId: 'user-2',
        reason: ReportReason.SPAM,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockReport);
      expect(service.createReport).toHaveBeenCalledWith('user-1', 'user-2', ReportReason.SPAM, undefined);
    });
  });

  describe('getReportsByUser', () => {
    it('should return reports for a reporter', async () => {
      const result = await controller.getReportsByUser('user-1');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getReportsForUser', () => {
    it('should return reports for a reported user', async () => {
      const result = await controller.getReportsForUser('user-2');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getPendingReports', () => {
    it('should return pending reports', async () => {
      const result = await controller.getPendingReports();
      expect(result.success).toBe(true);
    });
  });

  describe('getReportCount', () => {
    it('should return report count', async () => {
      const result = await controller.getReportCount('user-2');
      expect(result.success).toBe(true);
      expect(result.data.count).toBe(3);
    });
  });

  describe('updateReportStatus', () => {
    it('should update report status', async () => {
      const result = await controller.updateReportStatus('uuid-1', {
        status: ReportStatus.REVIEWED,
        reviewedBy: 'admin',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getReportReasons', () => {
    it('should return list of report reasons', () => {
      const result = controller.getReportReasons();
      expect(result.success).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0]).toHaveProperty('id');
      expect(result.data[0]).toHaveProperty('label');
      expect(result.data[0]).toHaveProperty('labelVi');
    });
  });
});
