/**
 * AbuseIPDB Integration Service
 * 
 * Tích hợp với AbuseIPDB để kiểm tra danh tiếng IP
 * và tự động chặn các địa chỉ IP độc hại
 */

import axios from 'axios';
import { siemService, SIEMEvent } from './index';

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

// Cấu hình AbuseIPDB
export interface AbuseIPDBConfig {
  apiKey: string;
  maxAgeInDays: number;
  confidenceThreshold: number; // 0-100
}

// Kết quả kiểm tra IP
export interface IPReputationResult {
  ipAddress: string;
  isPublic: boolean;
  confidenceScore: number; // 0-100
  totalReports: number;
  lastReportedAt: string | null;
  countryCode: string | null;
  countryName: string | null;
  isp: string | null;
  isWhitelisted: boolean;
  isBlacklisted: boolean;
  blacklistSource?: string;
  isBlocked: boolean;
  blockDuration?: number;
  abuseCategories: string[];
  originalResponse?: any;
}

class AbuseIPDBService {
  private config: AbuseIPDBConfig | null = null;
  private apiUrl = 'https://api.abuseipdb.com/api/v2';
  private cache: Map<string, IPReputationResult> = new Map();
  private cacheExpiration: Map<string, number> = new Map();
  private readonly CACHE_TTL = 3600000; // 1 hour in milliseconds
  
  /**
   * Cài đặt cấu hình AbuseIPDB
   * @param config Cấu hình AbuseIPDB
   */
  public configure(config: AbuseIPDBConfig): void {
    this.config = config;
    logger.info('AbuseIPDB service configured');
  }
  
  /**
   * Kiểm tra danh tiếng IP
   * @param ipAddress Địa chỉ IP cần kiểm tra
   */
  public async checkIpReputation(ipAddress: string): Promise<IPReputationResult | null> {
    if (!this.config) {
      throw new Error('AbuseIPDB service not configured');
    }
    
    // Kiểm tra cache
    const now = Date.now();
    if (this.cache.has(ipAddress) && this.cacheExpiration.get(ipAddress)! > now) {
      logger.debug(`Using cached reputation for ${ipAddress}`);
      return this.cache.get(ipAddress)!;
    }
    
    try {
      const response = await axios.get(`${this.apiUrl}/check`, {
        params: {
          ipAddress,
          maxAgeInDays: this.config.maxAgeInDays
        },
        headers: {
          Key: this.config.apiKey,
          Accept: 'application/json'
        }
      });
      
      const data = response.data.data;
      
      // Phân tích kết quả
      const result: IPReputationResult = {
        ipAddress: data.ipAddress,
        isPublic: data.isPublic,
        confidenceScore: data.abuseConfidenceScore,
        totalReports: data.totalReports,
        lastReportedAt: data.lastReportedAt,
        countryCode: data.countryCode,
        countryName: data.countryName,
        isp: data.isp,
        isWhitelisted: data.isWhitelisted || false,
        isBlacklisted: this.isConfidenceAboveThreshold(data.abuseConfidenceScore),
        isBlocked: false, // Mặc định chưa bị chặn
        abuseCategories: this.parseCategories(data.reports),
        originalResponse: data
      };
      
      // Lưu cache
      this.cache.set(ipAddress, result);
      this.cacheExpiration.set(ipAddress, now + this.CACHE_TTL);
      
      return result;
    } catch (error) {
      logger.error(`Failed to check IP reputation for ${ipAddress}: ${error}`);
      return null;
    }
  }
  
  /**
   * Tạo sự kiện SIEM từ kết quả kiểm tra IP
   * @param result Kết quả kiểm tra danh tiếng IP
   * @param sourceEvent Sự kiện nguồn (tùy chọn)
   * @param deviceId ID thiết bị (mặc định: 0)
   */
  public createSIEMEvent(result: IPReputationResult, sourceEvent?: any, deviceId: number = 0): SIEMEvent {
    // Xác định mức độ nghiêm trọng
    let severity: 'low' | 'medium' | 'high' = 'low';
    if (result.confidenceScore >= 90) {
      severity = 'high';
    } else if (result.confidenceScore >= 50) {
      severity = 'medium';
    }
    
    // Mô tả
    let description = `IP ${result.ipAddress} có điểm danh tiếng ${result.confidenceScore}/100`;
    if (result.countryName) {
      description += ` từ ${result.countryName}`;
    }
    if (result.totalReports > 0) {
      description += ` với ${result.totalReports} báo cáo`;
    }
    if (result.abuseCategories.length > 0) {
      description += `. Danh mục: ${result.abuseCategories.join(', ')}`;
    }
    
    // Tạo sự kiện SIEM
    const siemEvent: SIEMEvent = {
      timestamp: new Date().toISOString(),
      eventType: 'IP_REPUTATION',
      sourceIp: result.ipAddress,
      destinationIp: '0.0.0.0', // Không có IP đích cụ thể
      severity: severity,
      confidence: result.confidenceScore / 100, // Chuyển từ thang 0-100 sang 0-1
      description: description,
      deviceId: deviceId,
      attackType: this.getMostSevereCategory(result.abuseCategories),
      raw: JSON.stringify(result.originalResponse)
    };
    
    return siemEvent;
  }
  
  /**
   * Kiểm tra xem score có vượt ngưỡng không
   * @param score Điểm tin cậy từ AbuseIPDB (0-100)
   */
  private isConfidenceAboveThreshold(score: number): boolean {
    if (!this.config) return false;
    return score >= this.config.confidenceThreshold;
  }
  
  /**
   * Trích xuất danh mục từ báo cáo
   * @param reports Mảng báo cáo từ AbuseIPDB
   */
  private parseCategories(reports: any[] | undefined): string[] {
    if (!reports || !Array.isArray(reports) || reports.length === 0) {
      return [];
    }
    
    const categories = new Set<string>();
    const categoryMap: Record<number, string> = {
      1: 'DNS_COMPROMISE',
      2: 'DNS_POISONING',
      3: 'FRAUD_ORDERS',
      4: 'DDOS_ATTACK',
      5: 'FTP_BRUTE_FORCE',
      6: 'PING_OF_DEATH',
      7: 'PHISHING',
      8: 'FRAUD_VOIP',
      9: 'OPEN_PROXY',
      10: 'WEB_SPAM',
      11: 'EMAIL_SPAM',
      12: 'BLOG_SPAM',
      13: 'VPN_IP',
      14: 'PORT_SCAN',
      15: 'HACKING',
      16: 'SQL_INJECTION',
      17: 'SPOOFING',
      18: 'BRUTE_FORCE',
      19: 'BAD_WEB_BOT',
      20: 'EXPLOITED_HOST',
      21: 'WEB_APP_ATTACK',
      22: 'SSH',
      23: 'IOT_TARGETED'
    };
    
    for (const report of reports) {
      if (report.categories && Array.isArray(report.categories)) {
        for (const categoryId of report.categories) {
          const categoryName = categoryMap[categoryId] || `CATEGORY_${categoryId}`;
          categories.add(categoryName);
        }
      }
    }
    
    return Array.from(categories);
  }
  
  /**
   * Lấy loại tấn công nghiêm trọng nhất
   * @param categories Danh sách danh mục
   */
  private getMostSevereCategory(categories: string[]): string {
    if (categories.length === 0) return 'UNKNOWN';
    
    // Ưu tiên các loại tấn công nghiêm trọng
    const highPriority = [
      'DDOS_ATTACK', 'HACKING', 'SQL_INJECTION', 'WEB_APP_ATTACK',
      'EXPLOITED_HOST', 'DNS_COMPROMISE', 'DNS_POISONING'
    ];
    
    for (const category of highPriority) {
      if (categories.includes(category)) return category;
    }
    
    return categories[0]; // Trả về danh mục đầu tiên nếu không có ưu tiên cao
  }
  
  /**
   * Cập nhật trạng thái chặn cho IP
   * @param ipAddress Địa chỉ IP
   * @param isBlocked Đã chặn hay chưa
   * @param blockDuration Thời gian chặn (phút)
   * @param source Nguồn chặn (tên danh sách, lệnh, v.v.)
   */
  public updateBlockStatus(ipAddress: string, isBlocked: boolean, blockDuration?: number, source?: string): void {
    if (this.cache.has(ipAddress)) {
      const result = this.cache.get(ipAddress)!;
      result.isBlocked = isBlocked;
      if (blockDuration) result.blockDuration = blockDuration;
      if (source) result.blacklistSource = source;
      this.cache.set(ipAddress, result);
    }
  }
}

export const abuseIPDBService = new AbuseIPDBService();