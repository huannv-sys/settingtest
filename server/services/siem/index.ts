/**
 * SIEM Integration Service
 * 
 * Tích hợp hệ thống phát hiện bất thường với SIEM (Security Information and Event Management)
 * Cho phép xuất và phân tích log theo định dạng chuẩn
 */

import fs from 'fs';
import path from 'path';
import { idsService } from '../ids';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../../db';
import { schema } from '../../../shared/schema';
import { networkTrafficFeatures, idsDetectionHistory } from '../../../shared/schema';

// Tạo logger
const logger = (() => {
  try {
    const { logger } = require('../../logger');
    return logger;
  } catch (error) {
    return {
      info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
      warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
      error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
      debug: (message: string, ...args: any[]) => {
        if (process.env.DEBUG === 'true') {
          console.debug(`[DEBUG] ${message}`, ...args);
        }
      }
    };
  }
})();

// Định dạng dữ liệu cho SIEM
export interface SIEMEvent {
  timestamp: string;
  eventType: string;
  sourceIp: string;
  destinationIp: string;
  sourcePort?: number;
  destinationPort?: number;
  protocol?: string;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  description: string;
  deviceId: number;
  attackType?: string;
  userId?: string;
  raw?: string;
}

// Định dạng báo cáo tổng hợp SIEM
export interface SIEMReport {
  total_anomalies: number;
  ip_summary: Record<string, {
    attempts: number;
    attack_types: string[];
    timestamps: string[];
    ports?: number[];
    confidence: number;
    severity: string;
  }>;
  logs: SIEMEvent[];
}

class SIEMService {
  private reportsDir: string;
  private isInitialized: boolean = false;

  constructor() {
    // Tạo thư mục báo cáo nếu không tồn tại
    this.reportsDir = path.join(process.cwd(), 'reports');
    this.initialize();
  }

  /**
   * Khởi tạo dịch vụ SIEM
   */
  private async initialize(): Promise<void> {
    try {
      // Tạo thư mục reports nếu chưa tồn tại
      if (!fs.existsSync(this.reportsDir)) {
        fs.mkdirSync(this.reportsDir, { recursive: true });
      }
      this.isInitialized = true;
      logger.info('SIEM service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize SIEM service: ${error}`);
      this.isInitialized = false;
    }
  }

  /**
   * Lấy báo cáo bất thường từ một khoảng thời gian
   * @param startTime Thời gian bắt đầu
   * @param endTime Thời gian kết thúc
   * @param deviceId ID thiết bị (tùy chọn)
   * @param minConfidence Độ tin cậy tối thiểu (0-1)
   */
  public async generateAnomalyReport(
    startTime: Date,
    endTime: Date,
    deviceId?: number,
    minConfidence: number = 0.9
  ): Promise<SIEMReport> {
    try {
      // Xây dựng truy vấn
      let query = db.select().from(idsDetectionHistory)
        .where(and(
          gte(idsDetectionHistory.timestamp, startTime),
          lte(idsDetectionHistory.timestamp, endTime),
          eq(idsDetectionHistory.isAnomaly, true)
        ));

      // Thêm điều kiện thiết bị nếu có
      if (deviceId) {
        query = query.where(eq(idsDetectionHistory.deviceId, deviceId));
      }

      // Thực hiện truy vấn
      const anomalies = await query;

      // Lọc theo độ tin cậy tối thiểu
      const filteredAnomalies = anomalies.filter(a => a.probability >= minConfidence);

      // Tạo danh sách sự kiện SIEM
      const logs: SIEMEvent[] = [];
      const ipSummary: Record<string, {
        attempts: number;
        attack_types: string[];
        timestamps: string[];
        ports: number[];
        confidence: number;
        severity: string;
      }> = {};

      // Lấy dữ liệu chi tiết cho mỗi bất thường
      for (const anomaly of filteredAnomalies) {
        // Lấy dữ liệu gói tin
        const trafficFeature = await db.select()
          .from(networkTrafficFeatures)
          .where(eq(networkTrafficFeatures.id, anomaly.trafficFeatureId))
          .limit(1);

        if (trafficFeature.length === 0) continue;

        const traffic = trafficFeature[0];
        const details = anomaly.details as any;

        // Xác định mức độ nghiêm trọng
        let severity: 'low' | 'medium' | 'high' = 'medium';
        if (anomaly.probability >= 0.95) {
          severity = 'high';
        } else if (anomaly.probability >= 0.8) {
          severity = 'medium';
        } else {
          severity = 'low';
        }

        // Tạo event
        const event: SIEMEvent = {
          timestamp: anomaly.timestamp.toISOString(),
          eventType: 'NETWORK_ANOMALY',
          sourceIp: traffic.sourceIp,
          destinationIp: traffic.destinationIp,
          sourcePort: traffic.sourcePort,
          destinationPort: traffic.destinationPort,
          protocol: traffic.protocol,
          severity: severity,
          confidence: anomaly.probability,
          description: details.description || 'Unknown anomaly',
          deviceId: anomaly.deviceId,
          attackType: details.anomalyType || 'UNKNOWN',
          raw: JSON.stringify(details)
        };

        logs.push(event);

        // Cập nhật tóm tắt theo IP nguồn
        if (!ipSummary[traffic.sourceIp]) {
          ipSummary[traffic.sourceIp] = {
            attempts: 0,
            attack_types: [],
            timestamps: [],
            ports: [],
            confidence: 0,
            severity: severity
          };
        }

        ipSummary[traffic.sourceIp].attempts++;
        if (!ipSummary[traffic.sourceIp].attack_types.includes(event.attackType!)) {
          ipSummary[traffic.sourceIp].attack_types.push(event.attackType!);
        }
        ipSummary[traffic.sourceIp].timestamps.push(event.timestamp);
        if (!ipSummary[traffic.sourceIp].ports.includes(event.destinationPort!)) {
          ipSummary[traffic.sourceIp].ports.push(event.destinationPort!);
        }
        
        // Cập nhật độ tin cậy cao nhất
        if (anomaly.probability > ipSummary[traffic.sourceIp].confidence) {
          ipSummary[traffic.sourceIp].confidence = anomaly.probability;
          ipSummary[traffic.sourceIp].severity = severity;
        }
      }

      // Tạo báo cáo
      const report: SIEMReport = {
        total_anomalies: logs.length,
        ip_summary: ipSummary,
        logs: logs
      };

      return report;
    } catch (error) {
      logger.error(`Error generating SIEM anomaly report: ${error}`);
      throw error;
    }
  }

  /**
   * Lưu báo cáo SIEM ra file
   * @param report Báo cáo SIEM
   * @param filename Tên file (tùy chọn)
   */
  public async saveReportToFile(report: SIEMReport, filename?: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Tạo tên file mặc định nếu không được cung cấp
      const reportFilename = filename || `siem_report_${new Date().toISOString().replace(/:/g, '-')}.json`;
      const reportPath = path.join(this.reportsDir, reportFilename);

      // Ghi file báo cáo
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 4));
      logger.info(`SIEM report saved to ${reportPath}`);

      return reportPath;
    } catch (error) {
      logger.error(`Error saving SIEM report: ${error}`);
      throw error;
    }
  }

  /**
   * Trích xuất dữ liệu log từ thiết bị Mikrotik
   * @param deviceId ID thiết bị
   * @param startTime Thời gian bắt đầu
   * @param endTime Thời gian kết thúc
   */
  public async extractRawLogs(deviceId: number, startTime: Date, endTime: Date): Promise<any[]> {
    // Giả lập phương thức này - sẽ cần được triển khai khi có quyền truy cập đến log thực
    logger.info(`Extracting raw logs for device ${deviceId} from ${startTime} to ${endTime}`);
    
    // Sẽ được triển khai sau khi có quyền truy cập log từ thiết bị
    return [];
  }

  /**
   * Tạo định dạng logs tương thích CEF (Common Event Format) cho SIEM
   * @param report Báo cáo SIEM
   */
  public convertToCEF(report: SIEMReport): string[] {
    const cefLogs: string[] = [];
    
    for (const event of report.logs) {
      // Format: CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
      const cefHeader = `CEF:0|MikroTik|RouterOS|6.45.9|${event.attackType || 'ANOMALY'}|Network Anomaly|${this.mapSeverityToCEF(event.severity)}|`;
      
      // Add extensions
      const extensions = [
        `src=${event.sourceIp}`,
        `dst=${event.destinationIp}`,
        `spt=${event.sourcePort || 0}`,
        `dpt=${event.destinationPort || 0}`,
        `proto=${event.protocol || 'unknown'}`,
        `confidence=${(event.confidence * 100).toFixed(2)}`,
        `deviceId=${event.deviceId}`,
        `msg=${event.description}`
      ].join(' ');
      
      cefLogs.push(`${cefHeader}${extensions}`);
    }
    
    return cefLogs;
  }
  
  /**
   * Map severity level to CEF severity (0-10)
   */
  private mapSeverityToCEF(severity: 'low' | 'medium' | 'high'): number {
    switch (severity) {
      case 'high': return 9;
      case 'medium': return 6;
      case 'low': return 3;
      default: return 0;
    }
  }
}

export const siemService = new SIEMService();