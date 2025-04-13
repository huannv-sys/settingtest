/**
 * SIEM Client Service
 * 
 * Cung cấp tích hợp với các hệ thống SIEM ngoài như:
 * - Elasticsearch/Kibana
 * - Graylog
 * - LogRhythm
 * - ArcSight
 * - Splunk
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { SIEMReport, SIEMEvent } from './index';

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

// Định nghĩa loại SIEM hỗ trợ
export type SIEMType = 'elastic' | 'graylog' | 'splunk' | 'logrhythm' | 'arcsight';

// Cấu hình cho SIEM
export interface SIEMConfig {
  type: SIEMType;
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
  index?: string; // Elasticsearch index
  token?: string;
  port?: number;
  useSSL?: boolean;
}

class SIEMClient {
  private config: SIEMConfig | null = null;

  /**
   * Cài đặt cấu hình kết nối với SIEM
   * @param config Cấu hình SIEM
   */
  public async configureConnection(config: SIEMConfig): Promise<boolean> {
    try {
      this.config = config;
      
      // Kiểm tra kết nối
      await this.testConnection();
      
      // Lưu cấu hình để sử dụng lại
      this.saveConfiguration(config);
      
      logger.info(`SIEM connection configured for ${config.type}`);
      return true;
    } catch (error) {
      logger.error(`Failed to configure SIEM connection: ${error}`);
      this.config = null;
      return false;
    }
  }

  /**
   * Kiểm tra kết nối đến SIEM
   */
  public async testConnection(): Promise<boolean> {
    if (!this.config) {
      throw new Error('SIEM configuration not set');
    }

    try {
      switch (this.config.type) {
        case 'elastic':
          // Test Elasticsearch connection
          await axios.get(`${this.config.url}/_cluster/health`, {
            headers: this.config.apiKey ? {
              'Authorization': `ApiKey ${this.config.apiKey}`
            } : undefined,
            auth: (!this.config.apiKey && this.config.username && this.config.password) ? {
              username: this.config.username,
              password: this.config.password
            } : undefined
          });
          break;
          
        case 'graylog':
          // Test Graylog connection
          await axios.get(`${this.config.url}/api/system/lbstatus`, {
            headers: this.config.token ? {
              'Authorization': `Bearer ${this.config.token}`
            } : undefined,
            auth: (!this.config.token && this.config.username && this.config.password) ? {
              username: this.config.username,
              password: this.config.password
            } : undefined
          });
          break;
          
        case 'splunk':
          // Test Splunk connection
          await axios.get(`${this.config.url}/services/server/info`, {
            headers: {
              'Authorization': `Bearer ${this.config.token}`
            }
          });
          break;
          
        default:
          // Các loại SIEM khác sẽ được triển khai sau
          logger.warn(`Test connection for ${this.config.type} not implemented yet, assuming success`);
          break;
      }
      
      logger.info(`Successfully connected to ${this.config.type} SIEM`);
      return true;
    } catch (error) {
      logger.error(`Failed to connect to SIEM: ${error}`);
      throw error;
    }
  }

  /**
   * Lưu cấu hình SIEM vào tệp
   * @param config Cấu hình SIEM
   */
  private saveConfiguration(config: SIEMConfig): void {
    try {
      const configDir = path.join(process.cwd(), 'config');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Tạo bản sao để xóa mật khẩu khi lưu
      const safeConfig = { ...config };
      if (safeConfig.password) {
        safeConfig.password = '******'; // Ẩn mật khẩu thực
      }
      
      const configPath = path.join(configDir, 'siem_config.json');
      fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2));
      
      logger.info(`SIEM configuration saved to ${configPath}`);
    } catch (error) {
      logger.error(`Failed to save SIEM configuration: ${error}`);
    }
  }

  /**
   * Gửi sự kiện đến SIEM
   * @param events Danh sách sự kiện cần gửi
   */
  public async sendEvents(events: SIEMEvent[]): Promise<{ success: boolean; sent: number; failed: number }> {
    if (!this.config) {
      throw new Error('SIEM configuration not set');
    }
    
    let sent = 0;
    let failed = 0;
    
    try {
      switch (this.config.type) {
        case 'elastic':
          // Gửi đến Elasticsearch
          for (const event of events) {
            try {
              const index = this.config.index || 'mikrotik-security-events';
              await axios.post(`${this.config.url}/${index}/_doc`, event, {
                headers: this.config.apiKey ? {
                  'Authorization': `ApiKey ${this.config.apiKey}`,
                  'Content-Type': 'application/json'
                } : {
                  'Content-Type': 'application/json'
                },
                auth: (!this.config.apiKey && this.config.username && this.config.password) ? {
                  username: this.config.username,
                  password: this.config.password
                } : undefined
              });
              sent++;
            } catch (e) {
              logger.error(`Failed to send event to Elasticsearch: ${e}`);
              failed++;
            }
          }
          break;
          
        case 'graylog':
          // Gửi đến Graylog qua GELF HTTP input
          for (const event of events) {
            try {
              // Chuyển đổi định dạng event sang GELF
              const gelfEvent = {
                version: '1.1',
                host: `mikrotik-${event.deviceId}`,
                short_message: event.description,
                full_message: event.raw,
                timestamp: new Date(event.timestamp).getTime() / 1000,
                level: this.mapSeverityToSyslog(event.severity),
                _source_ip: event.sourceIp,
                _destination_ip: event.destinationIp,
                _source_port: event.sourcePort,
                _destination_port: event.destinationPort,
                _protocol: event.protocol,
                _confidence: event.confidence,
                _attack_type: event.attackType || 'UNKNOWN',
                _event_type: event.eventType
              };
              
              await axios.post(`${this.config.url}/gelf`, gelfEvent, {
                headers: this.config.token ? {
                  'Authorization': `Bearer ${this.config.token}`,
                  'Content-Type': 'application/json'
                } : {
                  'Content-Type': 'application/json'
                },
                auth: (!this.config.token && this.config.username && this.config.password) ? {
                  username: this.config.username,
                  password: this.config.password
                } : undefined
              });
              sent++;
            } catch (e) {
              logger.error(`Failed to send event to Graylog: ${e}`);
              failed++;
            }
          }
          break;
          
        case 'splunk':
          // Gửi đến Splunk qua HTTP Event Collector
          for (const event of events) {
            try {
              const splunkEvent = {
                time: new Date(event.timestamp).getTime() / 1000,
                host: `mikrotik-${event.deviceId}`,
                source: 'mikrotik-ids',
                sourcetype: 'mikrotik:security',
                index: this.config.index || 'main',
                event: {
                  ...event,
                  severity_name: event.severity,
                  severity_value: this.mapSeverityToSyslog(event.severity)
                }
              };
              
              await axios.post(`${this.config.url}/services/collector/event`, splunkEvent, {
                headers: {
                  'Authorization': `Splunk ${this.config.token}`,
                  'Content-Type': 'application/json'
                }
              });
              sent++;
            } catch (e) {
              logger.error(`Failed to send event to Splunk: ${e}`);
              failed++;
            }
          }
          break;
          
        default:
          logger.error(`Sending events to ${this.config.type} not implemented yet`);
          failed = events.length;
          break;
      }
      
      logger.info(`Sent ${sent}/${events.length} events to ${this.config.type} SIEM`);
      return { success: failed === 0, sent, failed };
    } catch (error) {
      logger.error(`Error sending events to SIEM: ${error}`);
      return { success: false, sent, failed: events.length - sent };
    }
  }

  /**
   * Gửi báo cáo đầy đủ đến SIEM
   * @param report Báo cáo SIEM
   */
  public async sendReport(report: SIEMReport): Promise<{ success: boolean; sent: number; failed: number }> {
    return this.sendEvents(report.logs);
  }

  /**
   * Ánh xạ độ nghiêm trọng sang mức Syslog
   * @param severity Độ nghiêm trọng
   */
  private mapSeverityToSyslog(severity: 'low' | 'medium' | 'high'): number {
    switch (severity) {
      case 'high': return 2; // Critical
      case 'medium': return 4; // Warning
      case 'low': return 6; // Informational
      default: return 7; // Debug
    }
  }
}

export const siemClient = new SIEMClient();