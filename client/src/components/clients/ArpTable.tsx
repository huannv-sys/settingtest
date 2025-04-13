import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, Badge, Spinner } from '../ui/bootstrap';

interface ArpTableProps {
  deviceId?: number;
}

interface ArpEntry {
  id: string;
  address: string;
  macAddress: string;
  interface: string;
  complete?: string;
  disabled?: string;
  dynamic?: string;
  invalid?: string;
  lastSeen?: Date;
  deviceId?: number;
}

const ArpTable: React.FC<ArpTableProps> = ({ deviceId: propDeviceId }) => {
  const [arpEntries, setArpEntries] = useState<ArpEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Sử dụng deviceId từ props hoặc mặc định là thiết bị 1
  const deviceId = propDeviceId?.toString() || "1";

  useEffect(() => {
    const fetchArpEntries = async () => {
      try {
        setLoading(true);
        console.log("Đang lấy thông tin bảng ARP cho thiết bị:", deviceId);
        const response = await axios.get(`/api/devices/${deviceId}/arp`);
        
        if (response.data.success) {
          console.log("Nhận được dữ liệu bảng ARP:", response.data);
          
          if (response.data.data && response.data.data.arpEntries) {
            setArpEntries(response.data.data.arpEntries || []);
          } else {
            // Fallback nếu cấu trúc khác
            setArpEntries(Array.isArray(response.data.data) ? response.data.data : []);
            console.log("Sử dụng cấu trúc dữ liệu fallback");
          }
        } else {
          setError(response.data.message || 'Không thể tải dữ liệu bảng ARP');
          console.error("Lỗi API:", response.data.message);
        }
      } catch (err: any) {
        setError(err.message || 'Đã xảy ra lỗi khi tải dữ liệu');
        console.error('Lỗi khi lấy thông tin bảng ARP:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchArpEntries();
  }, [deviceId]);

  if (loading) {
    return <div className="text-center p-3">
      <Spinner animation="border" /> <span className="ml-2">Đang tải dữ liệu bảng ARP...</span>
    </div>;
  }

  if (error) {
    return <div className="alert alert-danger">
      {error}
    </div>;
  }

  if (arpEntries.length === 0) {
    return <div className="alert alert-info">Không tìm thấy bản ghi ARP nào</div>;
  }

  return (
    <div>
      <div className="table-responsive">
        <table className="table table-sm table-hover">
          <thead>
            <tr>
              <th>#</th>
              <th>Địa chỉ IP</th>
              <th>Địa chỉ MAC</th>
              <th>Interface</th>
              <th>Trạng thái</th>
              <th>Loại</th>
            </tr>
          </thead>
          <tbody>
            {arpEntries.map((entry, index) => (
              <tr key={entry.id || index}>
                <td>{index + 1}</td>
                <td>{entry.address}</td>
                <td>{entry.macAddress}</td>
                <td>{entry.interface}</td>
                <td>
                  {entry.complete === 'true' ? (
                    <Badge variant="success">Hoạt động</Badge>
                  ) : (
                    <Badge variant="secondary">Chưa hoàn thành</Badge>
                  )}
                </td>
                <td>
                  {entry.dynamic === 'true' ? (
                    <Badge variant="info">Động</Badge>
                  ) : (
                    <Badge variant="secondary">Tĩnh</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ArpTable;