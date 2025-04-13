import React from 'react';
import { useParams } from 'wouter';
import FirewallRulesTable from '../../../components/security/FirewallRulesTable';

// Trang hiển thị firewall rules cho một thiết bị cụ thể
const FirewallRulesPage: React.FC = () => {
  // Lấy deviceId từ params URL
  const params = useParams();
  
  return (
    <div className="container">
      <FirewallRulesTable />
    </div>
  );
};

export default FirewallRulesPage;