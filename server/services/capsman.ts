import { CapsmanAP, InsertCapsmanAP, CapsmanClient, InsertCapsmanClient } from '../../shared/schema';
import { storage } from '../storage';
import { alertSeverity, AlertSeverity } from '../../shared/schema';
import { mikrotikService } from './mikrotik';

/**
 * CapsmanService - Quản lý CAPsMAN (Controlled Access Point System Manager) của MikroTik
 */
export class CapsmanService {
  /**
   * Lấy danh sách CAPsMAN Access Points của một thiết bị
   */
  async getCapsmanAPs(deviceId: number): Promise<CapsmanAP[]> {
    try {
      return await storage.getCapsmanAPs(deviceId);
    } catch (error) {
      console.error(`Error getting CAPsMAN APs for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Lấy chi tiết một CAPsMAN Access Point
   */
  async getCapsmanAP(id: number): Promise<CapsmanAP | undefined> {
    try {
      return await storage.getCapsmanAP(id);
    } catch (error) {
      console.error(`Error getting CAPsMAN AP ${id}:`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách clients kết nối vào một CAPsMAN Access Point
   */
  async getCapsmanClients(apId: number): Promise<CapsmanClient[]> {
    try {
      return await storage.getCapsmanClients(apId);
    } catch (error) {
      console.error(`Error getting CAPsMAN clients for AP ${apId}:`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách tất cả clients kết nối vào các AP của một thiết bị CAPsMAN
   */
  async getCapsmanClientsByDevice(deviceId: number): Promise<CapsmanClient[]> {
    try {
      return await storage.getCapsmanClientsByDevice(deviceId);
    } catch (error) {
      console.error(`Error getting CAPsMAN clients for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Lấy chi tiết một CAPsMAN client
   */
  async getCapsmanClient(id: number): Promise<CapsmanClient | undefined> {
    try {
      return await storage.getCapsmanClient(id);
    } catch (error) {
      console.error(`Error getting CAPsMAN client ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Thu thập thông tin CAPsMAN từ thiết bị MikroTik
   */
  async collectCapsmanStats(deviceId: number): Promise<void> {
    const client = mikrotikService.getClientForDevice(deviceId);
    if (!client) {
      throw new Error(`No connection to device ${deviceId}`);
    }
    
    try {
      console.log(`Collecting CAPsMAN data for device ${deviceId}...`);
      
      // Tìm kiếm interface CAP từ danh sách interfaces thay vì sử dụng CapsMan
      let capsmanAPData = [];
      
      try {
        console.log(`Tìm kiếm các interface CAP từ danh sách interfaces...`);
        // Lấy tất cả interfaces
        const interfaces = await client.executeCommand('/interface/print');
        
        if (Array.isArray(interfaces)) {
          console.log(`Tìm thấy ${interfaces.length} interfaces, đang lọc các interface cap/wlan...`);
          
          // Chỉ lọc các interface dạng cap 
          capsmanAPData = interfaces.filter(iface => {
            // Chỉ lấy các interface có type là 'cap'
            return iface.type === 'cap';
          });
          
          console.log(`Tìm thấy ${capsmanAPData.length} interface CAP/WLAN`);
        }
      } catch (error) {
        console.error(`Lỗi khi lấy danh sách interfaces:`, error);
        
        // Thử phương pháp thông thường 
        try {
          // Thử dùng cú pháp RouterOS 6 (cách cũ)
          capsmanAPData = await client.executeCommand('/caps-man/access-point/print', [
            { 'detail': '' } // Lấy thêm thông tin chi tiết
          ]);
        } catch (error) {
          // Nếu có lỗi, thử dùng cú pháp RouterOS 7 (cách mới)
          console.log(`Thử lại với cú pháp RouterOS 7 không có detail param...`);
          try {
            capsmanAPData = await client.executeCommand('/caps-man/access-point/print');
          } catch (error2) {
            // Thử một cách khác: sử dụng cú pháp "interface/caps-man"
            console.log(`Thử lại với đường dẫn interface/caps-man...`);
            try {
              capsmanAPData = await client.executeCommand('/interface/caps-man/access-point/print');
            } catch (error3) {
              console.error(`Không thể lấy dữ liệu access-point từ CAPsMAN:`, error3);
              // Sử dụng mảng rỗng để tránh lỗi
              capsmanAPData = [];
            }
          }
        }
      }
      
      if (!Array.isArray(capsmanAPData)) {
        console.warn('Không lấy được dữ liệu CAPsMAN AP, đang sử dụng mảng rỗng');
        capsmanAPData = [];
      }
      
      console.log(`Found ${capsmanAPData.length} CAPsMAN access points`);
      
      // Đánh dấu các CAPsMAN APs hiện tại để xóa những AP không còn tồn tại
      const currentAPIds = new Set<number>();
      const existingAPs = await storage.getCapsmanAPs(deviceId);
      
      // Lấy thông tin cấu hình CAPsMAN để biết thêm chi tiết
      let capsmanConfig = [];
      try {
        capsmanConfig = await client.executeCommand('/caps-man/manager/print');
        console.log(`CAPsMAN manager configuration:`, capsmanConfig);
      } catch (configError) {
        console.warn(`Could not get CAPsMAN manager configuration with original path:`, configError);
        // Thử đường dẫn thay thế
        try {
          capsmanConfig = await client.executeCommand('/interface/caps-man/manager/print');
          console.log(`CAPsMAN manager configuration (alternative path):`, capsmanConfig);
        } catch (altError) {
          console.warn(`Could not get CAPsMAN manager with alternative path:`, altError);
        }
      }
      
      // Lấy thông tin các cấu hình không dây của CAPsMAN
      let capsmanConfigs = [];
      try {
        capsmanConfigs = await client.executeCommand('/caps-man/configuration/print');
        console.log(`Found ${capsmanConfigs.length} CAPsMAN configurations`);
      } catch (configsError) {
        console.warn(`Could not get CAPsMAN configurations with original path:`, configsError);
        // Thử đường dẫn thay thế
        try {
          capsmanConfigs = await client.executeCommand('/interface/caps-man/configuration/print');
          console.log(`Found ${capsmanConfigs.length} CAPsMAN configurations (alternative path)`);
        } catch (altError) {
          console.warn(`Could not get CAPsMAN configurations with alternative path:`, altError);
        }
      }
      
      for (const ap of capsmanAPData) {
        console.log(`Processing CAPsMAN AP: ${ap.name || ap['mac-address']}`, ap);
        
        // Tìm CAPsMAN AP đã tồn tại trong cơ sở dữ liệu
        const existingAP = existingAPs.find(a => a.name === ap.name || a.macAddress === ap['mac-address']);
        
        // Lấy thông tin cấu hình mà AP này đang sử dụng
        let configName = ap['configuration'] || '';
        let configDetails = '';
        
        if (configName && Array.isArray(capsmanConfigs)) {
          const config = capsmanConfigs.find(c => c.name === configName);
          if (config) {
            configDetails = `${config['mode'] || ''} ${config['band'] || ''} ${config['channel-width'] || ''}`;
            console.log(`AP ${ap.name} using configuration: ${configName}, details: ${configDetails}`);
          }
        }
        
        // Lấy danh sách các registered clients cho AP này
        let clients = 0;
        
        // Lấy thông tin đếm clients theo actual interface, không dựa vào registration-table
        try {
          // Tìm kiếm registrations dựa theo đúng interface name
          const allRegistrations = await client.executeCommand('/caps-man/registration-table/print');
          
          if (Array.isArray(allRegistrations)) {
            // Lọc chính xác những client kết nối vào interface này
            const apClients = allRegistrations.filter(reg => reg.interface === ap.name);
            clients = apClients.length;
            console.log(`AP ${ap.name} has ${clients} directly connected clients based on registration-table`);
          }
        } catch (regError) {
          console.warn(`Could not get registration table for all APs:`, regError);
          
          // Thử lại với đường dẫn thay thế
          try {
            const altRegistrations = await client.executeCommand('/interface/caps-man/registration-table/print');
            
            if (Array.isArray(altRegistrations)) {
              const apClients = altRegistrations.filter(reg => reg.interface === ap.name);
              clients = apClients.length;
              console.log(`AP ${ap.name} has ${clients} directly connected clients from alt path`);
            }
          } catch (altError) {
            console.warn(`Could not get registration table with alternative path:`, altError);
            
            // Sử dụng phương pháp dự phòng - dùng wireless/registration-table nếu đây là interface wireless
            if (ap.type === 'wlan') {
              try {
                const wirelessRegs = await client.executeCommand('/interface/wireless/registration-table/print', [
                  { '?interface': ap.name }
                ]);
                clients = Array.isArray(wirelessRegs) ? wirelessRegs.length : 0;
                console.log(`AP ${ap.name} has ${clients} wireless registered clients`);
              } catch (wirelessError) {
                console.warn(`Could not get wireless registration table for AP ${ap.name}:`, wirelessError);
              }
            }
          }
        }
        
        const apData: InsertCapsmanAP = {
          deviceId,
          name: ap.name || '',
          macAddress: ap['mac-address'] || '',
          ipAddress: ap['current-ip-address'] || null,
          model: ap.type || ap['board'] || null,
          serialNumber: ap['serial-number'] || null,
          version: ap['version'] || null,
          identity: ap['identity'] || ap.name || null,
          radioMac: ap['radio-mac'] || ap['mac-address'] || null,
          radioName: ap['radio-name'] || null,
          state: ap.running === 'true' ? 'running' : 
                 ap.disabled === 'true' ? 'disabled' :
                 ap.running === 'false' ? 'down' : 
                 ap['state'] || null,
          uptime: ap['uptime'] || null,
          clients,
          // Thêm thông tin công suất và độ nhiễu
          txPower: ap['tx-power'] || null,
          rxSignal: ap['rx-signal'] || null,
          channel: ap['channel'] || null,
          band: ap['band'] || null,
          channelWidth: ap['channel-width'] || null
        };
        
        if (existingAP) {
          // Cập nhật AP đã tồn tại
          const updatedAP = await storage.updateCapsmanAP(existingAP.id, apData);
          if (updatedAP) {
            currentAPIds.add(updatedAP.id);
            await this.checkCapsmanAPStatus(deviceId, existingAP, apData);
            await this.collectCapsmanClients(deviceId, updatedAP.id);
          }
        } else {
          // Tạo mới AP
          const newAP = await storage.createCapsmanAP(apData);
          currentAPIds.add(newAP.id);
          await this.collectCapsmanClients(deviceId, newAP.id);
        }
      }
      
      // Xóa APs không còn tồn tại
      for (const ap of existingAPs) {
        if (!currentAPIds.has(ap.id)) {
          await storage.deleteCapsmanAP(ap.id);
        }
      }
      
    } catch (error) {
      console.error(`Error collecting CAPsMAN stats for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Thu thập thông tin về clients kết nối vào một AP
   */
  async collectCapsmanClients(deviceId: number, apId: number): Promise<void> {
    const client = mikrotikService.getClientForDevice(deviceId);
    if (!client) {
      throw new Error(`No connection to device ${deviceId}`);
    }
    
    try {
      const ap = await storage.getCapsmanAP(apId);
      if (!ap) {
        throw new Error(`CAPsMAN AP with ID ${apId} not found`);
      }
      
      console.log(`Collecting clients for CAPsMAN AP ${ap.name} (ID: ${apId})...`);
      
      // Lấy danh sách các registered clients cho AP này
      let registrations = [];
      try {
        // Thử cách 1: Sử dụng đường dẫn cũ
        registrations = await client.executeCommand('/caps-man/registration-table/print', [
          { '?interface': ap.name }
        ]);
      } catch (regError) {
        console.warn(`Could not get registration table with original path:`, regError);
        try {
          // Thử cách 2: Sử dụng đường dẫn mới
          registrations = await client.executeCommand('/interface/caps-man/registration-table/print', [
            { '?interface': ap.name }
          ]);
        } catch (altError) {
          console.warn(`Could not get registration table with alternative path:`, altError);
        }
      }
      
      if (!Array.isArray(registrations)) {
        console.warn(`No valid registration data for AP ${ap.name}`);
        registrations = []; // Đảm bảo registrations luôn là một mảng
      }
      
      console.log(`Found ${registrations.length} clients for AP ${ap.name}`);
      
      // Lấy tất cả clients hiện tại của AP này từ cơ sở dữ liệu
      const existingClients = await storage.getCapsmanClients(apId);
      const currentClientIds = new Set<number>();
      
      for (const reg of registrations) {
        console.log(`Processing client: ${reg['mac-address']}`, reg);
        
        // Tìm client đã tồn tại trong cơ sở dữ liệu
        const existingClient = existingClients.find(c => c.macAddress === reg['mac-address']);
        
        const clientData: InsertCapsmanClient = {
          apId,
          deviceId,
          macAddress: reg['mac-address'] || '',
          interface: reg['interface'] || '',
          hostname: reg['comment'] || null, // Thường hostname được lưu trong comment
          ipAddress: reg['last-ip'] || null,
          signalStrength: reg['signal-strength'] ? parseInt(reg['signal-strength']) : null,
          txRate: reg['tx-rate'] || null,
          rxRate: reg['rx-rate'] || null,
          connectedTime: reg['uptime'] || null,
          username: reg['username'] || null
          // Các trường dữ liệu không có trong schema đã bị loại bỏ:
          // signal, ccq, rate, uptime, lastActivity, bytes, packets, rxSignal, txSignal
        };
        
        if (existingClient) {
          // Cập nhật client đã tồn tại
          const updatedClient = await storage.updateCapsmanClient(existingClient.id, clientData);
          if (updatedClient) {
            currentClientIds.add(updatedClient.id);
          }
        } else {
          // Tạo mới client
          const newClient = await storage.createCapsmanClient(clientData);
          currentClientIds.add(newClient.id);
          
          // Tạo cảnh báo về client mới kết nối
          await mikrotikService.createAlert(
            deviceId,
            alertSeverity.INFO,
            `New client connected to AP ${ap.name}: ${clientData.macAddress}${clientData.hostname ? ` (${clientData.hostname})` : ''}`,
            "capsman"
          );
        }
      }
      
      // Xóa các client không còn kết nối nữa
      for (const client of existingClients) {
        if (!currentClientIds.has(client.id)) {
          await storage.deleteCapsmanClient(client.id);
          
          // Tạo cảnh báo về client đã ngắt kết nối
          await mikrotikService.createAlert(
            deviceId,
            alertSeverity.INFO,
            `Client disconnected from AP ${ap.name}: ${client.macAddress}${client.hostname ? ` (${client.hostname})` : ''}`,
            "capsman"
          );
        }
      }
      
    } catch (error) {
      console.error(`Error collecting CAPsMAN clients for AP ${apId} on device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Kiểm tra trạng thái AP và tạo cảnh báo nếu cần
   */
  private async checkCapsmanAPStatus(
    deviceId: number,
    oldAP: CapsmanAP,
    newAPData: InsertCapsmanAP
  ): Promise<void> {
    // Kiểm tra sự thay đổi trạng thái hoạt động
    if (oldAP.state !== newAPData.state) {
      let severity: AlertSeverity = alertSeverity.INFO;
      if (newAPData.state === 'running') {
        severity = alertSeverity.INFO;
      } else if (newAPData.state === 'disabled') {
        severity = alertSeverity.WARNING;
      } else {
        severity = alertSeverity.ERROR;  // Thay CRITICAL bằng ERROR
      }
      
      const message = `CAPsMAN AP ${newAPData.name} status changed from ${oldAP.state || 'unknown'} to ${newAPData.state || 'unknown'}`;
      await mikrotikService.createAlert(deviceId, severity, message, "capsman");
    }
    
    // Bỏ kiểm tra tín hiệu vì trường rxSignal không tồn tại trong schema
    // CapsmanAP và InsertCapsmanAP không có trường rxSignal
  }
}

export const capsmanService = new CapsmanService();