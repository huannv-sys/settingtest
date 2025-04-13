import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface FirewallRulesTableProps {
  deviceId?: number;
}

interface FirewallRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  dstPort?: string;
  srcPort?: string;
  srcAddress?: string;
  dstAddress?: string;
  inInterface?: string;
  outInterface?: string;
  comment?: string;
  disabled?: boolean;
  invalid?: boolean;
  dynamic?: boolean;
  connectionState?: string;
  connectionNat?: string;
  srcAddressList?: string;
  dstAddressList?: string;
  bytes?: string;
  packets?: string;
  rawData?: any;
}

const FirewallRulesTable: React.FC<FirewallRulesTableProps> = ({ deviceId: propDeviceId }) => {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [processingRules, setProcessingRules] = useState<Record<string, boolean>>({});
  const [selectedRule, setSelectedRule] = useState<FirewallRule | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const params = useParams();
  // Sử dụng deviceId từ props nếu được cung cấp, nếu không thì lấy từ params
  const deviceId = propDeviceId?.toString() || params.deviceId || "1";

  useEffect(() => {
    const fetchRules = async () => {
      try {
        setLoading(true);
        console.log("Fetching firewall rules for device:", deviceId);
        const response = await axios.get(`/api/devices/${deviceId}/firewall/filter`);
        
        if (response.data.success) {
          // Kiểm tra cấu trúc của dữ liệu trả về
          console.log("Received firewall rules data:", response.data);
          
          if (response.data.data && response.data.data.filterRules) {
            // Xử lý dữ liệu để thêm các trường bổ sung từ rawData
            const enhancedRules = response.data.data.filterRules.map((rule: any) => {
              // Trích xuất các trường từ rawData để hiển thị thêm
              const srcAddressList = rule.rawData?.['src-address-list'] || '';
              const dstAddressList = rule.rawData?.['dst-address-list'] || '';
              const bytes = rule.rawData?.bytes || '0';
              const packets = rule.rawData?.packets || '0';
              
              return {
                ...rule,
                srcAddressList,
                dstAddressList,
                bytes,
                packets
              };
            });
            
            setRules(enhancedRules || []);
            console.log("Enhanced filter rules:", enhancedRules);
          } else {
            // Fallback nếu cấu trúc khác
            setRules(Array.isArray(response.data.data) ? response.data.data : []);
            console.log("Using fallback data structure");
          }
        } else {
          setError(response.data.message || 'Không thể tải dữ liệu firewall rules');
          console.error("API error:", response.data.message);
        }
      } catch (err: any) {
        setError(err.message || 'Đã xảy ra lỗi khi tải dữ liệu');
        console.error('Error fetching firewall rules:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRules();
  }, [deviceId]);

  // Xử lý bật/tắt rule
  const handleToggleRule = async (ruleId: string) => {
    try {
      // Đánh dấu rule đang được xử lý
      setProcessingRules(prev => ({ ...prev, [ruleId]: true }));
      
      // Gọi API để toggle rule
      const response = await axios.post(`/api/devices/${deviceId}/firewall/filter/${ruleId}/toggle`);
      
      if (response.data.success) {
        // Cập nhật lại state khi thành công
        setRules(prevRules => 
          prevRules.map(rule => 
            rule.id === ruleId 
              ? { ...rule, disabled: response.data.data.disabled } 
              : rule
          )
        );
        
        // Hiển thị thông báo thành công
        console.log(`Rule ${ruleId} đã được ${response.data.data.disabled ? 'tắt' : 'bật'}`);
      } else {
        // Xử lý lỗi từ API
        console.error('Lỗi khi toggle rule:', response.data.message);
      }
    } catch (err: any) {
      console.error('Lỗi khi gọi API toggle rule:', err.message);
    } finally {
      // Xóa trạng thái xử lý
      setProcessingRules(prev => {
        const newState = { ...prev };
        delete newState[ruleId];
        return newState;
      });
    }
  };
  
  // Hiển thị modal chi tiết rule
  const showRuleDetails = (rule: FirewallRule) => {
    setSelectedRule(rule);
    setShowDetailModal(true);
  };
  
  // Định dạng bytes để hiển thị dễ đọc (KB, MB, GB)
  const formatBytes = (bytes: string) => {
    if (!bytes) return '0 B';
    
    const bytesNum = parseInt(bytes, 10);
    if (isNaN(bytesNum)) return '0 B';
    
    if (bytesNum === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytesNum) / Math.log(k));
    
    return parseFloat((bytesNum / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  // Render trạng thái của rule
  const renderState = (rule: FirewallRule) => {
    if (rule.disabled) {
      return <Badge variant="secondary">Disabled</Badge>;
    }
    if (rule.invalid) {
      return <Badge variant="danger">Invalid</Badge>;
    }
    if (rule.dynamic) {
      return <Badge variant="info">Dynamic</Badge>;
    }
    return <Badge variant="secondary">Active</Badge>;
  };

  const getBadgeForAction = (action: string) => {
    switch(action) {
      case 'accept': return <Badge variant="success">{action}</Badge>;
      case 'drop': return <Badge variant="danger">{action}</Badge>;
      case 'forward': return <Badge variant="info">{action}</Badge>;
      case 'add-src-to-address-list':
      case 'add-dst-to-address-list': return <Badge variant="info">{action}</Badge>;
      case 'return':
      case 'jump': return <Badge variant="warning">{action}</Badge>;
      default: return <Badge variant="secondary">{action}</Badge>;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8">
      <Spinner className="mr-2" /> Đang tải dữ liệu firewall rules...
    </div>;
  }

  if (error) {
    return <div className="bg-destructive/15 text-destructive p-4 rounded-md">
      {error}
    </div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end items-center">
        <Button variant="primary">Add Rule</Button>
      </div>

      {rules.length === 0 ? (
        <div className="p-4 rounded-md bg-muted">Không tìm thấy firewall rules nào</div>
      ) : (
        <div className="rounded-md overflow-auto border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Src. Address</TableHead>
                <TableHead>Dst. Address</TableHead>
                <TableHead>Proto.</TableHead>
                <TableHead>Src. Port</TableHead>
                <TableHead>Dst. Port</TableHead>
                <TableHead>In. Interface</TableHead>
                <TableHead>Out Int.</TableHead>
                <TableHead>Bytes</TableHead>
                <TableHead>Packets</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule, index) => (
                <TableRow key={rule.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>{rule.comment || '-'}</TableCell>
                  <TableCell>{rule.chain}</TableCell>
                  <TableCell>
                    {getBadgeForAction(rule.action)}
                  </TableCell>
                  <TableCell>{rule.srcAddress || rule.srcAddressList || '-'}</TableCell>
                  <TableCell>{rule.dstAddress || rule.dstAddressList || '-'}</TableCell>
                  <TableCell>{rule.protocol || 'any'}</TableCell>
                  <TableCell>{rule.srcPort || '-'}</TableCell>
                  <TableCell>{rule.dstPort || '-'}</TableCell>
                  <TableCell>{rule.inInterface || '-'}</TableCell>
                  <TableCell>{rule.outInterface || '-'}</TableCell>
                  <TableCell>{formatBytes(rule.bytes || '0')}</TableCell>
                  <TableCell>{rule.packets || '0'}</TableCell>
                  <TableCell>{renderState(rule)}</TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button 
                        variant={rule.disabled ? "success" : "secondary"}
                        size="sm"
                        onClick={() => handleToggleRule(rule.id)}
                        disabled={processingRules[rule.id]}
                      >
                        {processingRules[rule.id] 
                          ? <><span className="spinner-border spinner-border-sm mr-1"></span> Đang xử lý...</>
                          : (rule.disabled ? "Bật" : "Tắt")
                        }
                      </Button>
                      <Button 
                        variant="primary"
                        size="sm"
                        className="ml-2"
                        onClick={() => showRuleDetails(rule)}
                      >
                        Chi tiết
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      {/* Dialog hiển thị chi tiết rule */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Chi tiết Firewall Rule</DialogTitle>
            <DialogDescription>Thông tin chi tiết về firewall rule</DialogDescription>
          </DialogHeader>
            
            {selectedRule && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">
                  {selectedRule.comment ? selectedRule.comment : 'Rule ' + selectedRule.id}
                </h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="font-bold text-blue-300">ID</div>
                    <div className="mt-1 text-gray-300">{selectedRule.id}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Chain</div>
                    <div className="mt-1 text-gray-300">{selectedRule.chain}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Action</div>
                    <div className="mt-1 text-gray-300">{selectedRule.action}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Protocol</div>
                    <div className="mt-1 text-gray-300">{selectedRule.protocol || 'any'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Source Address</div>
                    <div className="mt-1 text-gray-300">{selectedRule.srcAddress || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Source Address List</div>
                    <div className="mt-1 text-gray-300">{selectedRule.srcAddressList || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Destination Address</div>
                    <div className="mt-1 text-gray-300">{selectedRule.dstAddress || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Destination Address List</div>
                    <div className="mt-1 text-gray-300">{selectedRule.dstAddressList || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Source Port</div>
                    <div className="mt-1 text-gray-300">{selectedRule.srcPort || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Destination Port</div>
                    <div className="mt-1 text-gray-300">{selectedRule.dstPort || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">In Interface</div>
                    <div className="mt-1 text-gray-300">{selectedRule.inInterface || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Out Interface</div>
                    <div className="mt-1 text-gray-300">{selectedRule.outInterface || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Connection State</div>
                    <div className="mt-1 text-gray-300">{selectedRule.connectionState || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Connection NAT</div>
                    <div className="mt-1 text-gray-300">{selectedRule.connectionNat || '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Bytes</div>
                    <div className="mt-1 text-gray-300">{formatBytes(selectedRule.bytes || '0')}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">Packets</div>
                    <div className="mt-1 text-gray-300">{selectedRule.packets || '0'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-300">State</div>
                    <div className="mt-1 text-gray-300">
                      {selectedRule.disabled ? 'Disabled' : 
                       selectedRule.invalid ? 'Invalid' : 
                       selectedRule.dynamic ? 'Dynamic' : 'Active'}
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="font-bold text-blue-300">Raw Data</div>
                  <textarea 
                    rows={8} 
                    readOnly 
                    value={JSON.stringify(selectedRule.rawData, null, 2)}
                    className="w-full p-2 font-mono text-sm border rounded bg-[#111827] text-gray-300"
                  />
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button 
                variant="secondary"
                onClick={() => setShowDetailModal(false)}
              >
                Đóng
              </Button>
              <Button 
                variant={selectedRule?.disabled ? "success" : "secondary"}
                onClick={() => {
                  if (selectedRule) {
                    handleToggleRule(selectedRule.id);
                    setShowDetailModal(false);
                  }
                }}
              >
                {selectedRule?.disabled ? "Bật Rule" : "Tắt Rule"}
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FirewallRulesTable;