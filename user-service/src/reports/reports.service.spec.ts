import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Report, ReportReason, ReportStatus } from './report.entity';

describe('ReportsService', () => {
  let service: ReportsService;
  let mockRepo: any;

  const mockReport: Report = {
    id: 'uuid-1',
    reporterId: 'user-1',
    reportedUserId: 'user-2',
    reason: ReportReason.SPAM,
    description: 'Test report',
    status: ReportStatus.PENDING,
    reviewedBy: null as any,
    reviewNotes: null as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 'uuid-new', createdAt: new Date(), updatedAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Report), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReport', () => {
    it('should create a new report', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.createReport('user-1', 'user-2', ReportReason.SPAM, 'Test');

      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw if user reported same person within 24 hours', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...mockReport,
        createdAt: new Date(), // just created
      });

      await expect(service.createReport('user-1', 'user-2', ReportReason.SPAM))
        .rejects.toThrow(BadRequestException);
    });

    it('should allow re-report after 24 hours', async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 25);
      mockRepo.findOne.mockResolvedValue({
        ...mockReport,
        createdAt: oldDate,
      });

      const result = await service.createReport('user-1', 'user-2', ReportReason.HARASSMENT);
      expect(result).toBeDefined();
    });
  });

  describe('getReportsByUser', () => {
    it('should return reports by reporter', async () => {
      mockRepo.find.mockResolvedValue([mockReport]);

      const result = await service.getReportsByUser('user-1');

      expect(result).toHaveLength(1);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { reporterId: 'user-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('getReportsForUser', () => {
    it('should return reports for a reported user', async () => {
      mockRepo.find.mockResolvedValue([mockReport]);

      const result = await service.getReportsForUser('user-2');

      expect(result).toHaveLength(1);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { reportedUserId: 'user-2' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('getPendingReports', () => {
    it('should return pending reports', async () => {
      mockRepo.find.mockResolvedValue([mockReport]);

      const result = await service.getPendingReports();

      expect(result).toHaveLength(1);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { status: ReportStatus.PENDING },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('updateReportStatus', () => {
    it('should update report status', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockReport });

      const result = await service.updateReportStatus('uuid-1', ReportStatus.REVIEWED, 'admin-1', 'Reviewed');

      expect(result.status).toBe(ReportStatus.REVIEWED);
      expect(result.reviewedBy).toBe('admin-1');
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should throw if report not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.updateReportStatus('invalid-id', ReportStatus.REVIEWED, 'admin'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('getReportCount', () => {
    it('should return report count for a user', async () => {
      mockRepo.count.mockResolvedValue(5);

      const result = await service.getReportCount('user-2');

      expect(result).toBe(5);
      expect(mockRepo.count).toHaveBeenCalledWith({
        where: { reportedUserId: 'user-2' },
      });
    });
  });
});
