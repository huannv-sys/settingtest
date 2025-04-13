/**
 * Wazuh Integration Service
 * 
 * Tích hợp với Wazuh SIEM để phân tích log bảo mật
 * và tự động phản ứng với các mối đe dọa
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { SIEMEvent, SIEMReport } from './index';
import { abuseIPDBService } from './abuseipdb';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

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

// Cấu hình Wazuh
export interface WazuhConfig {
  apiUrl: string;          // URL của Wazuh API (https://wazuh-server:55000)
  username: string;        // Tên đăng nhập API Wazuh
  password: string;        // Mật khẩu API Wazuh
  sshKeyPath?: string;     // Đường dẫn đến SSH key (tùy chọn)
  mikrotikAddress?: string;// Địa chỉ IP của MikroTik (tùy chọn)
  sshUsername?: string;    // Username SSH (tùy chọn)
  authLogPath?: string;    // Đường dẫn tới auth.log (tùy chọn)
}

// Cấu trúc dữ liệu cho Rule
export interface WazuhRule {
  id: string;
  level: number;
  description: string;
  match?: string;
  regex?: string;
  decoded_as?: string;
}

// Cấu trúc dữ liệu cho Decoder
export interface WazuhDecoder {
  name: string;
  prematch?: string;
  regex?: string;
  order?: string;
}

// Cấu trúc Alert từ Wazuh
export interface WazuhAlert {
  id: string;
  timestamp: string;
  rule: {
    id: string;
    level: number;
    description: string;
  };
  agent: {
    id: string;
    name: string;
  };
  manager: {
    name: string;
  };
  data: {
    srcip?: string;
    dstip?: string;
    srcport?: string;
    dstport?: string;
    protocol?: string;
    action?: string;
    user?: string;
    access_method?: string;
  };
  location: string;
  full_log: string;
}

class WazuhService {
  private config: WazuhConfig | null = null;
  private token: string | null = null;
  private tokenExpiration: number = 0;
  private rulesDir: string;
  private decodersDir: string;
  
  constructor() {
    // Các thư mục cài đặt rule và decoder
    this.rulesDir = path.join(process.cwd(), 'wazuh', 'rules');
    this.decodersDir = path.join(process.cwd(), 'wazuh', 'decoders');
    
    // Đảm bảo thư mục tồn tại
    if (!fs.existsSync(this.rulesDir)) {
      fs.mkdirSync(this.rulesDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.decodersDir)) {
      fs.mkdirSync(this.decodersDir, { recursive: true });
    }
  }
  
  /**
   * Cài đặt cấu hình Wazuh
   * @param config Cấu hình Wazuh
   */
  public async configure(config: WazuhConfig): Promise<boolean> {
    try {
      this.config = config;
      
      // Kiểm tra kết nối
      await this.authenticate();
      
      logger.info('Wazuh service configured successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to configure Wazuh service: ${error}`);
      return false;
    }
  }
  
  /**
   * Xác thực với Wazuh API
   */
  private async authenticate(): Promise<void> {
    if (!this.config) {
      throw new Error('Wazuh service not configured');
    }
    
    // Kiểm tra token còn hiệu lực không
    if (this.token && Date.now() < this.tokenExpiration) {
      return;
    }
    
    try {
      const response = await axios.post(
        `${this.config.apiUrl}/security/user/authenticate`,
        {},
        {
          auth: {
            username: this.config.username,
            password: this.config.password
          },
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      this.token = response.data.data.token;
      // Thiết lập thời gian hết hạn (1h)
      this.tokenExpiration = Date.now() + 3600000;
    } catch (error) {
      logger.error(`Failed to authenticate with Wazuh API: ${error}`);
      throw error;
    }
  }
  
  /**
   * Tải và cài đặt các rule và decoder từ file XML
   * @param rulesXml Nội dung file XML chứa rules
   * @param decodersXml Nội dung file XML chứa decoders
   */
  public async installRulesAndDecoders(rulesXml: string, decodersXml: string): Promise<boolean> {
    try {
      // Lưu rules
      const rulesPath = path.join(this.rulesDir, 'mikrotik_rules.xml');
      fs.writeFileSync(rulesPath, rulesXml);
      logger.info(`Saved Mikrotik rules to ${rulesPath}`);
      
      // Lưu decoders
      const decodersPath = path.join(this.decodersDir, 'mikrotik_decoders.xml');
      fs.writeFileSync(decodersPath, decodersXml);
      logger.info(`Saved Mikrotik decoders to ${decodersPath}`);
      
      // Khởi động lại Wazuh Manager nếu có cấu hình SSH
      if (this.config?.sshKeyPath && this.config?.mikrotikAddress && this.config?.sshUsername) {
        await this.restartWazuhManager();
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to install rules and decoders: ${error}`);
      return false;
    }
  }
  
  /**
   * Khởi động lại Wazuh Manager thông qua SSH
   */
  private async restartWazuhManager(): Promise<void> {
    if (!this.config?.sshKeyPath || !this.config?.mikrotikAddress || !this.config?.sshUsername) {
      logger.warn('Cannot restart Wazuh Manager: SSH configuration missing');
      return;
    }
    
    try {
      const command = `ssh -i ${this.config.sshKeyPath} -o StrictHostKeyChecking=no ${this.config.sshUsername}@${this.config.mikrotikAddress} "systemctl restart wazuh-manager"`;
      
      const { stdout, stderr } = await execPromise(command);
      
      if (stderr) {
        logger.warn(`Warnings when restarting Wazuh Manager: ${stderr}`);
      }
      
      logger.info(`Restarted Wazuh Manager: ${stdout}`);
    } catch (error) {
      logger.error(`Failed to restart Wazuh Manager: ${error}`);
      throw error;
    }
  }
  
  /**
   * Lấy danh sách các alert từ Wazuh
   * @param limit Số lượng alert tối đa
   * @param offset Vị trí bắt đầu
   */
  public async getAlerts(limit: number = 500, offset: number = 0): Promise<WazuhAlert[]> {
    await this.authenticate();
    
    try {
      const response = await axios.get(
        `${this.config!.apiUrl}/alerts`,
        {
          params: {
            limit,
            offset,
            sort: '-timestamp' // Sắp xếp theo thời gian mới nhất
          },
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data.data.affected_items;
    } catch (error) {
      logger.error(`Failed to get alerts from Wazuh: ${error}`);
      throw error;
    }
  }
  
  /**
   * Xử lý file auth.log từ MikroTik
   * @param authLogContent Nội dung file auth.log
   */
  public async processAuthLog(authLogContent: string): Promise<SIEMReport> {
    // Mẫu regex cho log thất bại đăng nhập
    const loginFailurePattern = /^(\w{3} \d{1,2} \d{2}:\d{2}:\d{2}).*login failure for user (\S+) from (\S+) via (\S+)$/gm;
    
    // Mẫu dữ liệu tổng hợp
    const ipSummary: Record<string, {
      attempts: number;
      users: string[];
      timestamps: string[];
      methods: string[];
    }> = {};
    
    const logs: any[] = [];
    
    // Phân tích file log
    let match;
    while ((match = loginFailurePattern.exec(authLogContent)) !== null) {
      const timestamp = match[1];
      const user = match[2];
      const ip = match[3];
      const method = match[4];
      
      // Lưu log đơn lẻ
      logs.push({
        timestamp,
        user,
        ip,
        method,
        raw: match[0]
      });
      
      // Cập nhật tổng hợp theo IP
      if (!ipSummary[ip]) {
        ipSummary[ip] = {
          attempts: 0,
          users: [],
          timestamps: [],
          methods: []
        };
      }
      
      ipSummary[ip].attempts++;
      
      if (!ipSummary[ip].users.includes(user)) {
        ipSummary[ip].users.push(user);
      }
      
      ipSummary[ip].timestamps.push(timestamp);
      
      if (!ipSummary[ip].methods.includes(method)) {
        ipSummary[ip].methods.push(method);
      }
    }
    
    // Chuyển đổi thành format SIEM
    const siemEvents: SIEMEvent[] = [];
    
    for (const log of logs) {
      // Phân loại mức độ nghiêm trọng
      let severity: 'low' | 'medium' | 'high' = 'medium';
      
      // Nếu là tài khoản admin hoặc root
      if (log.user.toLowerCase() === 'admin' || log.user.toLowerCase() === 'root') {
        severity = 'high';
      }
      
      // Nếu thử nhiều lần
      if (ipSummary[log.ip].attempts > 5) {
        severity = 'high';
      } else if (ipSummary[log.ip].attempts > 2) {
        severity = 'medium';
      }
      
      // Tính toán mức độ tin cậy
      let confidence = 0.5; // Mặc định
      
      if (ipSummary[log.ip].attempts > 10) {
        confidence = 0.98; // Gần như chắc chắn
      } else if (ipSummary[log.ip].attempts > 5) {
        confidence = 0.9;
      } else if (ipSummary[log.ip].attempts > 3) {
        confidence = 0.8;
      } else if (ipSummary[log.ip].attempts > 1) {
        confidence = 0.7;
      }
      
      // Điều chỉnh theo người dùng
      if (log.user.toLowerCase() === 'admin' || log.user.toLowerCase() === 'root') {
        confidence += 0.1;
      }
      
      // Giới hạn tối đa 1.0
      confidence = Math.min(confidence, 1.0);
      
      // Tạo sự kiện SIEM
      const currentYear = new Date().getFullYear();
      const fullTimestamp = `${log.timestamp} ${currentYear}`;
      const isoTimestamp = new Date(fullTimestamp).toISOString();
      
      const siemEvent: SIEMEvent = {
        timestamp: isoTimestamp,
        eventType: 'AUTH_FAILURE',
        sourceIp: log.ip,
        destinationIp: '0.0.0.0', // Không có IP đích cụ thể
        severity,
        confidence,
        description: `Đăng nhập thất bại cho người dùng ${log.user} từ ${log.ip} qua ${log.method}`,
        deviceId: 0, // Mặc định 0 cho MikroTik
        attackType: 'BRUTE_FORCE',
        userId: log.user,
        raw: log.raw
      };
      
      siemEvents.push(siemEvent);
    }
    
    // Tạo báo cáo SIEM
    const siemIpSummary: Record<string, {
      attempts: number;
      attack_types: string[];
      timestamps: string[];
      confidence: number;
      severity: string;
    }> = {};
    
    for (const ip in ipSummary) {
      // Tính toán mức độ nghiêm trọng của IP
      let ipSeverity: 'low' | 'medium' | 'high' = 'low';
      let ipConfidence = 0.5;
      
      // Dựa trên số lần thử
      if (ipSummary[ip].attempts > 10) {
        ipSeverity = 'high';
        ipConfidence = 0.98;
      } else if (ipSummary[ip].attempts > 5) {
        ipSeverity = 'high';
        ipConfidence = 0.9;
      } else if (ipSummary[ip].attempts > 2) {
        ipSeverity = 'medium';
        ipConfidence = 0.7;
      }
      
      // Dựa trên người dùng bị tấn công
      if (ipSummary[ip].users.some(u => u.toLowerCase() === 'admin' || u.toLowerCase() === 'root')) {
        ipSeverity = 'high';
        ipConfidence = Math.min(ipConfidence + 0.1, 1.0);
      }
      
      // Chuyển đổi timestamp
      const currentYear = new Date().getFullYear();
      const timestamps = ipSummary[ip].timestamps.map(ts => {
        const fullTs = `${ts} ${currentYear}`;
        return new Date(fullTs).toISOString();
      });
      
      siemIpSummary[ip] = {
        attempts: ipSummary[ip].attempts,
        attack_types: ['BRUTE_FORCE'],
        timestamps,
        confidence: ipConfidence,
        severity: ipSeverity
      };
    }
    
    return {
      total_anomalies: siemEvents.length,
      ip_summary: siemIpSummary,
      logs: siemEvents
    };
  }
  
  /**
   * Chạy mã tựa Analyzer.py với file auth.log
   * @param authLogPath Đường dẫn đến auth.log
   */
  public async runAnalyzerScript(authLogPath: string): Promise<SIEMReport> {
    try {
      // Đọc nội dung file auth.log
      const authLogContent = fs.readFileSync(authLogPath, 'utf8');
      
      // Xử lý file auth.log
      const report = await this.processAuthLog(authLogContent);
      
      return report;
    } catch (error) {
      logger.error(`Failed to run analyzer script: ${error}`);
      throw error;
    }
  }
  
  /**
   * Chạy lệnh firewall tự động trên MikroTik từ script Wazuh
   * @param ip Địa chỉ IP cần chặn
   */
  public async blockIPOnMikrotik(ip: string, duration: number = 90): Promise<boolean> {
    if (!this.config?.sshKeyPath || !this.config?.mikrotikAddress || !this.config?.sshUsername) {
      logger.warn('Cannot block IP on MikroTik: SSH configuration missing');
      return false;
    }
    
    try {
      // Lệnh để chặn IP trên MikroTik
      const firewallCommand = `/ip firewall address-list add list="blocked-by-siem" address=${ip} timeout=${duration}d comment="Added by SIEM"`;
      const command = `ssh -i ${this.config.sshKeyPath} -o StrictHostKeyChecking=no ${this.config.sshUsername}@${this.config.mikrotikAddress} "${firewallCommand}"`;
      
      const { stdout, stderr } = await execPromise(command);
      
      if (stderr) {
        logger.warn(`Warnings when blocking IP on MikroTik: ${stderr}`);
      }
      
      logger.info(`Blocked IP ${ip} on MikroTik for ${duration} days: ${stdout}`);
      
      // Cập nhật trạng thái chặn trong AbuseIPDB service nếu có
      abuseIPDBService.updateBlockStatus(ip, true, duration * 24 * 60, 'MikroTik Firewall');
      
      return true;
    } catch (error) {
      logger.error(`Failed to block IP on MikroTik: ${error}`);
      return false;
    }
  }
  
  /**
   * Chuyển đổi Wazuh Alerts thành SIEMEvents
   * @param alerts Danh sách cảnh báo từ Wazuh
   */
  public convertToSIEMEvents(alerts: WazuhAlert[]): SIEMEvent[] {
    return alerts.map(alert => {
      // Xác định mức độ nghiêm trọng
      let severity: 'low' | 'medium' | 'high';
      if (alert.rule.level >= 12) {
        severity = 'high';
      } else if (alert.rule.level >= 5) {
        severity = 'medium';
      } else {
        severity = 'low';
      }
      
      // Tính toán độ tin cậy dựa trên mức độ
      const confidence = Math.min(alert.rule.level / 15, 1.0);
      
      // Tạo sự kiện SIEM
      const siemEvent: SIEMEvent = {
        timestamp: alert.timestamp,
        eventType: 'WAZUH_ALERT',
        sourceIp: alert.data.srcip || '0.0.0.0',
        destinationIp: alert.data.dstip || '0.0.0.0',
        sourcePort: alert.data.srcport ? parseInt(alert.data.srcport) : undefined,
        destinationPort: alert.data.dstport ? parseInt(alert.data.dstport) : undefined,
        protocol: alert.data.protocol,
        severity,
        confidence,
        description: alert.rule.description,
        deviceId: 0, // Mặc định 0 cho MikroTik
        attackType: this.determineAttackType(alert),
        userId: alert.data.user,
        raw: alert.full_log
      };
      
      return siemEvent;
    });
  }
  
  /**
   * Xác định loại tấn công dựa trên Alert
   * @param alert Alert từ Wazuh
   */
  private determineAttackType(alert: WazuhAlert): string {
    // Rule ID 115001 và 115002 là cho đăng nhập thất bại
    if (alert.rule.id === '115001' || alert.rule.id === '115002') {
      return 'BRUTE_FORCE';
    }
    
    // Các loại tấn công khác có thể dựa vào mô tả
    const description = alert.rule.description.toLowerCase();
    
    if (description.includes('brute force') || description.includes('login fail')) {
      return 'BRUTE_FORCE';
    }
    
    if (description.includes('scan') || description.includes('scanning')) {
      return 'PORT_SCAN';
    }
    
    if (description.includes('dos') || description.includes('ddos') || description.includes('denial of service')) {
      return 'DDOS_ATTACK';
    }
    
    // Mặc định là UNKNOWN
    return 'UNKNOWN';
  }
}

export const wazuhService = new WazuhService();