/**
 * SIEM Adapters
 * 
 * Các adapter để tích hợp với các định dạng SIEM khác nhau
 * Hỗ trợ chuyển đổi dữ liệu giữa các định dạng khác nhau
 */

import fs from 'fs';
import path from 'path';
import { SIEMEvent, SIEMReport } from './index';

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

/**
 * Định dạng dữ liệu pyAnalyzer (như từ file Analyzer.py)
 */
export interface PyAnalyzerReport {
  total_failed_attempts: number;
  ip_summary: {
    [ip: string]: {
      attempts: number;
      users: string[];
      timestamps: string[];
    }
  };
  logs: {
    timestamp: string;
    user: string;
    ip: string;
    raw: string;
  }[];
}

/**
 * Adapter cho loại PyAnalyzer (ví dụ như từ file Analyzer.py)
 */
export class PyAnalyzerAdapter {
  /**
   * Đọc báo cáo từ file hoặc chuỗi JSON
   * @param source Đường dẫn file hoặc chuỗi JSON
   */
  public async readReport(source: string): Promise<PyAnalyzerReport> {
    try {
      let reportJson: string;
      
      // Kiểm tra nếu source là đường dẫn file
      if (fs.existsSync(source)) {
        reportJson = fs.readFileSync(source, 'utf-8');
      } else {
        // Giả định source là chuỗi JSON
        reportJson = source;
      }
      
      // Parse JSON
      const report = JSON.parse(reportJson) as PyAnalyzerReport;
      return report;
    } catch (error) {
      logger.error(`Error reading PyAnalyzer report: ${error}`);
      throw error;
    }
  }

  /**
   * Chuyển đổi báo cáo PyAnalyzer sang định dạng SIEM
   * @param report Báo cáo PyAnalyzer
   * @param deviceId ID thiết bị (mặc định: 0)
   */
  public convertToSIEMReport(report: PyAnalyzerReport, deviceId: number = 0): SIEMReport {
    try {
      // Tạo danh sách sự kiện SIEM
      const logs: SIEMEvent[] = report.logs.map((log, index) => {
        // Phân tích độ nghiêm trọng dựa trên nội dung log và người dùng
        let severity: 'low' | 'medium' | 'high' = 'medium';
        
        // Nếu là tài khoản root, đây là nguy cơ cao
        if (log.user.toLowerCase() === 'root' || log.user.toLowerCase() === 'admin') {
          severity = 'high';
        }
        
        // Kiểm tra số lượng thử - nếu có nhiều thử từ cùng một IP, tăng độ nghiêm trọng
        const attempts = report.ip_summary[log.ip]?.attempts || 0;
        if (attempts > 5) {
          severity = 'high';
        } else if (attempts > 2) {
          severity = 'medium';
        }
        
        // Tính toán độ tin cậy dựa trên thông tin có sẵn
        const confidence = this.calculateConfidence(log, report);
        
        return {
          timestamp: this.convertTimestamp(log.timestamp),
          eventType: 'AUTH_FAILURE',
          sourceIp: log.ip,
          destinationIp: '127.0.0.1', // Không có trong báo cáo gốc, giả định là local
          severity: severity,
          confidence: confidence,
          description: `Failed login attempt for user ${log.user} from ${log.ip}`,
          deviceId: deviceId,
          attackType: 'BRUTE_FORCE',
          userId: log.user,
          raw: log.raw
        };
      });

      // Tạo tóm tắt IP
      const ipSummary: Record<string, {
        attempts: number;
        attack_types: string[];
        timestamps: string[];
        confidence: number;
        severity: string;
      }> = {};

      for (const ip in report.ip_summary) {
        const summary = report.ip_summary[ip];
        let maxConfidence = 0;
        let highestSeverity: 'low' | 'medium' | 'high' = 'low';
        
        // Tính toán độ tin cậy và độ nghiêm trọng cao nhất cho IP này
        for (const log of report.logs) {
          if (log.ip === ip) {
            const confidence = this.calculateConfidence(log, report);
            if (confidence > maxConfidence) {
              maxConfidence = confidence;
            }
            
            // Kiểm tra user
            if (log.user.toLowerCase() === 'root' || log.user.toLowerCase() === 'admin') {
              highestSeverity = 'high';
            } else if (summary.attempts > 5 && highestSeverity !== 'high') {
              highestSeverity = 'high';
            } else if (summary.attempts > 2 && highestSeverity === 'low') {
              highestSeverity = 'medium';
            }
          }
        }
        
        ipSummary[ip] = {
          attempts: summary.attempts,
          attack_types: ['BRUTE_FORCE'],
          timestamps: summary.timestamps.map(ts => this.convertTimestamp(ts)),
          confidence: maxConfidence,
          severity: highestSeverity
        };
      }

      // Tạo báo cáo SIEM
      return {
        total_anomalies: logs.length,
        ip_summary: ipSummary,
        logs: logs
      };
    } catch (error) {
      logger.error(`Error converting PyAnalyzer report to SIEM format: ${error}`);
      throw error;
    }
  }

  /**
   * Tính toán độ tin cậy dựa trên thông tin có sẵn
   */
  private calculateConfidence(log: { timestamp: string; user: string; ip: string; raw: string }, report: PyAnalyzerReport): number {
    // Lấy số lần thử từ IP này
    const attempts = report.ip_summary[log.ip]?.attempts || 0;
    
    // Dựa trên số lần thử
    let confidence = 0.5; // Cơ bản
    
    // Tăng độ tin cậy theo số lần thử
    if (attempts > 10) {
      confidence = 0.98; // Gần như chắc chắn
    } else if (attempts > 5) {
      confidence = 0.9;
    } else if (attempts > 3) {
      confidence = 0.8;
    } else if (attempts > 1) {
      confidence = 0.7;
    }
    
    // Điều chỉnh theo người dùng
    if (log.user.toLowerCase() === 'root' || log.user.toLowerCase() === 'admin') {
      confidence += 0.1; // Tăng khi thử các tài khoản quan trọng
    }
    
    // Giới hạn tối đa 1.0
    return Math.min(confidence, 1.0);
  }

  /**
   * Chuyển đổi định dạng timestamp
   */
  private convertTimestamp(timestamp: string): string {
    // Thêm năm vào timestamp
    const currentYear = new Date().getFullYear();
    const fullTimestamp = `${timestamp} ${currentYear}`;
    
    try {
      // Parse và format lại timestamp
      const date = new Date(fullTimestamp);
      return date.toISOString();
    } catch (error) {
      logger.warn(`Failed to parse timestamp ${timestamp}, using current time`);
      return new Date().toISOString();
    }
  }
}

export const pyAnalyzerAdapter = new PyAnalyzerAdapter();