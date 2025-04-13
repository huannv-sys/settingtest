import { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Separator } from "../components/ui/separator";
import { 
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle 
} from "../components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "../components/ui/table";
import {
  BarChart,
  AreaChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { RefreshCw, AlertTriangle, Shield, Activity, Database } from "lucide-react";
import PageHeader from "../components/ui/page-header";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import LoadingSpinner from "../components/ui/loading-spinner";

interface TrafficAnomaly {
  id: number;
  sourceIp: string;
  destinationIp: string;
  sourcePort?: number;
  destinationPort?: number;
  protocol?: string;
  confidenceLevel: string;
  anomalyType: string;
  description: string;
  timestamp: string;
  highConfidence: boolean;
}

interface IPSummary {
  ip: string;
  attempts: number;
  attack_types: string[];
  confidence: number;
  severity: string;
}

interface SIEMReport {
  total_anomalies: number;
  logs: any[];
  ip_summary: Record<string, {
    attempts: number;
    attack_types: string[];
    timestamps: string[];
    confidence: number;
    severity: string;
  }>;
}

const TrafficAnalysisPage = () => {
  // Sử dụng axios thay vì client tùy chỉnh
  const client = axios;
  const [activeTab, setActiveTab] = useState("traffic");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [trafficData, setTrafficData] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<TrafficAnomaly[]>([]);
  const [ipSummaries, setIpSummaries] = useState<IPSummary[]>([]);
  const [siemReport, setSiemReport] = useState<SIEMReport | null>(null);
  const [autoMonitor, setAutoMonitor] = useState(false);
  const [deviceId, setDeviceId] = useState(1); // Default to first device
  const [error, setError] = useState<string | null>(null);

  // Phân tích lưu lượng mạng thực từ thiết bị
  const analyzeTraffic = async () => {
    setAnalyzing(true);
    setError(null);

    try {
      const response = await client.post('/security/analyze-real-traffic', {
        deviceId: deviceId,
        autoMode: autoMonitor
      });

      if (response.data.success) {
        setTrafficData(response.data.data);
        setAnomalies(response.data.data.anomalies || []);
        setAutoMonitor(response.data.data.autoMode);
      } else {
        setError(response.data.message || "Phân tích thất bại, vui lòng thử lại.");
      }
    } catch (err: any) {
      console.error("Lỗi khi phân tích lưu lượng:", err);
      setError(err.message || "Đã xảy ra lỗi khi phân tích lưu lượng mạng.");
    } finally {
      setAnalyzing(false);
    }
  };

  // Phân tích auth.log file
  const analyzeAuthLog = async () => {
    // Demo với file mẫu
    const demoFile = "/attached_assets/auth.log";
    setAnalyzing(true);
    setError(null);

    try {
      const response = await client.post('/siem/process-auth-log', {
        filepath: demoFile,
        deviceId: deviceId
      });

      if (response.data.success) {
        setSiemReport(response.data.data.report);
        
        // Chuyển đổi IP summary từ object sang mảng để dễ hiển thị
        const summaries: IPSummary[] = Object.entries(response.data.data.report.ip_summary).map(
          ([ip, data]: [string, any]) => ({
            ip,
            attempts: data.attempts,
            attack_types: data.attack_types,
            confidence: data.confidence,
            severity: data.severity
          })
        );
        
        setIpSummaries(summaries);
        setActiveTab("siem");
      } else {
        setError(response.data.message || "Phân tích auth.log thất bại.");
      }
    } catch (err: any) {
      console.error("Lỗi khi phân tích auth.log:", err);
      setError(err.message || "Đã xảy ra lỗi khi phân tích auth.log.");
    } finally {
      setAnalyzing(false);
    }
  };

  // Chuyển đổi dữ liệu dạng biểu đồ cho IP nguồn
  const getSourceIPChartData = () => {
    if (!anomalies || anomalies.length === 0) return [];
    
    // Đếm số lượng bất thường theo IP nguồn
    const ipCounts: Record<string, number> = {};
    anomalies.forEach(anomaly => {
      ipCounts[anomaly.sourceIp] = (ipCounts[anomaly.sourceIp] || 0) + 1;
    });
    
    // Chuyển đổi thành dạng mảng để sử dụng với biểu đồ
    return Object.keys(ipCounts).map(ip => ({
      name: ip,
      count: ipCounts[ip]
    }));
  };

  // Chuyển đổi dữ liệu dạng biểu đồ cho loại giao thức
  const getProtocolChartData = () => {
    if (!anomalies || anomalies.length === 0) return [];
    
    // Đếm số lượng bất thường theo giao thức
    const protocolCounts: Record<string, number> = {};
    anomalies.forEach(anomaly => {
      const protocol = anomaly.protocol || 'unknown';
      protocolCounts[protocol] = (protocolCounts[protocol] || 0) + 1;
    });
    
    // Chuyển đổi thành dạng mảng để sử dụng với biểu đồ
    return Object.keys(protocolCounts).map(protocol => ({
      name: protocol,
      count: protocolCounts[protocol]
    }));
  };

  // Lấy thống kê về số lượng bất thường theo thời gian
  const getAnomaliesByTime = () => {
    if (!anomalies || anomalies.length === 0) return [];
    
    // Nhóm theo giờ
    const hourlyData: Record<string, number> = {};
    anomalies.forEach(anomaly => {
      const date = new Date(anomaly.timestamp);
      const hourKey = `${date.getHours()}:00`;
      hourlyData[hourKey] = (hourlyData[hourKey] || 0) + 1;
    });
    
    // Chuyển đổi thành mảng sắp xếp theo thời gian
    return Object.keys(hourlyData)
      .sort((a, b) => {
        const hourA = parseInt(a.split(':')[0]);
        const hourB = parseInt(b.split(':')[0]);
        return hourA - hourB;
      })
      .map(hour => ({
        name: hour,
        anomalies: hourlyData[hour]
      }));
  };

  // Phân loại mức độ nghiêm trọng
  const getSeverityClass = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'high':
        return 'text-red-500 font-bold';
      case 'medium':
        return 'text-orange-500 font-semibold';
      case 'low':
        return 'text-blue-500';
      default:
        return '';
    }
  };

  // Kiểm tra API AbuseIPDB
  const checkIPReputation = async (ip: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await client.post('/siem/abuseipdb/check', {
        ip: ip,
        deviceId: deviceId
      });
      
      if (response.data.success) {
        // Thông báo kết quả cho người dùng
        alert(`IP ${ip}: ${response.data.data.reputation.confidenceScore}% mức độ đáng ngờ. ${response.data.data.blocked ? 'Đã tự động chặn IP.' : ''}`);
      } else {
        setError(response.data.message || "Không thể kiểm tra danh tiếng IP.");
      }
    } catch (err: any) {
      console.error("Lỗi khi kiểm tra IP:", err);
      setError(err.message || "Đã xảy ra lỗi khi kiểm tra danh tiếng IP.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Thiết lập cấu hình AbuseIPDB khi component được load (sử dụng API key người dùng)
    const setupAbuseIPDB = async () => {
      try {
        // API key cần được cung cấp bởi người dùng
        // client.post('/siem/abuseipdb/configure', {
        //   apiKey: 'YOUR_API_KEY', 
        //   confidenceThreshold: 25
        // });
      } catch (err) {
        console.error("Lỗi cấu hình AbuseIPDB:", err);
      }
    };
    
    // Chỉ comment để sau khi người dùng cung cấp API key
    // setupAbuseIPDB();
  }, []);

  return (
    <div className="container mx-auto py-6">
      <PageHeader 
        title="Phân tích lưu lượng mạng" 
        description="Phân tích và giám sát các bất thường trong lưu lượng mạng"
        icon={<Activity size={28} />}
      />
      
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Lỗi</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <div className="flex space-x-4 mb-4">
        <Button 
          onClick={analyzeTraffic} 
          disabled={analyzing}
          className="flex items-center"
        >
          {analyzing ? <LoadingSpinner size="sm" /> : <Activity className="mr-2 h-4 w-4" />}
          Phân tích log lưu lượng
        </Button>
        
        <Button 
          onClick={analyzeAuthLog} 
          disabled={analyzing}
          className="flex items-center"
        >
          {analyzing ? <LoadingSpinner size="sm" /> : <Database className="mr-2 h-4 w-4" />}
          Phân tích auth.log
        </Button>
        
        <Button 
          onClick={() => {
            setAutoMonitor(!autoMonitor);
            if (!autoMonitor) analyzeTraffic();
          }}
          className={`flex items-center ${autoMonitor ? "bg-primary text-primary-foreground" : "border border-input bg-background hover:bg-accent hover:text-accent-foreground"}`}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {autoMonitor ? "Tắt tự động giám sát" : "Bật tự động giám sát"}
        </Button>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="traffic">Lưu lượng</TabsTrigger>
          <TabsTrigger value="source">Nguồn</TabsTrigger>
          <TabsTrigger value="port">Cổng</TabsTrigger>
          <TabsTrigger value="protocol">Giao thức</TabsTrigger>
          <TabsTrigger value="siem">SIEM</TabsTrigger>
        </TabsList>
        
        <TabsContent value="traffic">
          {!trafficData && !analyzing ? (
            <Card className="bg-card text-card-foreground">
              <CardHeader>
                <CardTitle className="text-center">Lưu lượng mạng</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center min-h-[300px]">
                <p className="text-center text-muted-foreground mb-8">
                  Chưa có dữ liệu phân tích. Nhấn nút bên dưới để bắt đầu phân tích log lưu lượng.
                </p>
                <Button onClick={analyzeTraffic} className="flex items-center">
                  <Activity className="mr-2 h-4 w-4" />
                  Phân tích log lưu lượng
                </Button>
              </CardContent>
            </Card>
          ) : analyzing ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center min-h-[300px]">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-muted-foreground">Đang phân tích lưu lượng mạng...</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Tổng kết nối</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{trafficData.connectionCount}</div>
                    <p className="text-xs text-muted-foreground">Kết nối đang hoạt động</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Đã phân tích</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{trafficData.analyzedCount}</div>
                    <p className="text-xs text-muted-foreground">Các kết nối đã phân tích</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Bất thường</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{trafficData.anomalyCount}</div>
                    <p className="text-xs text-muted-foreground">
                      {trafficData.anomalyPercentage.toFixed(2)}% lưu lượng bất thường
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Đáng ngờ cao</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{trafficData.highConfidenceCount || 0}</div>
                    <p className="text-xs text-muted-foreground">
                      Cảnh báo với mức độ tin cậy cao
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Chart hiển thị xu hướng bất thường */}
              {anomalies.length > 0 && (
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle>Xu hướng bất thường</CardTitle>
                    <CardDescription>Phân bố bất thường theo thời gian</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={getAnomaliesByTime()}
                          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="colorAnomalies" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                              <stop offset="95%" stopColor="#8884d8" stopOpacity={0.1}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Area 
                            type="monotone" 
                            dataKey="anomalies" 
                            stroke="#8884d8" 
                            fillOpacity={1} 
                            fill="url(#colorAnomalies)" 
                            name="Bất thường"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Danh sách các bất thường */}
              <Card>
                <CardHeader>
                  <CardTitle>Chi tiết các bất thường</CardTitle>
                  <CardDescription>
                    {anomalies.length ? `Hiển thị ${anomalies.length} bất thường đáng chú ý` : 'Không tìm thấy bất thường'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>IP Nguồn</TableHead>
                        <TableHead>IP Đích</TableHead>
                        <TableHead>Giao thức</TableHead>
                        <TableHead>Độ tin cậy</TableHead>
                        <TableHead>Loại</TableHead>
                        <TableHead>Thao tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {anomalies.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center">
                            Không có dữ liệu bất thường
                          </TableCell>
                        </TableRow>
                      ) : (
                        anomalies.map((anomaly) => (
                          <TableRow key={anomaly.id}>
                            <TableCell>{anomaly.id}</TableCell>
                            <TableCell>{anomaly.sourceIp}</TableCell>
                            <TableCell>{anomaly.destinationIp}</TableCell>
                            <TableCell>{anomaly.protocol || '-'}</TableCell>
                            <TableCell className={anomaly.highConfidence ? "text-red-500 font-bold" : ""}>
                              {anomaly.confidenceLevel}
                            </TableCell>
                            <TableCell>{anomaly.anomalyType || 'Không xác định'}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => checkIPReputation(anomaly.sourceIp)}
                                disabled={loading}
                              >
                                <Shield className="h-4 w-4 mr-1" />
                                Kiểm tra
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
                {trafficData.autoMode && (
                  <CardFooter className="bg-muted/50 py-2">
                    <p className="text-xs text-muted-foreground">
                      <RefreshCw className="h-3 w-3 inline mr-1" />
                      Tự động quét lại sau {trafficData.nextScanIn}
                    </p>
                  </CardFooter>
                )}
              </Card>
            </>
          )}
        </TabsContent>
        
        <TabsContent value="source">
          <Card>
            <CardHeader>
              <CardTitle>Phân tích IP nguồn</CardTitle>
              <CardDescription>Phân bố các bất thường theo địa chỉ IP nguồn</CardDescription>
            </CardHeader>
            <CardContent>
              {!anomalies.length ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <p className="text-muted-foreground">Chưa có dữ liệu phân tích</p>
                </div>
              ) : (
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={getSourceIPChartData()}
                      margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="name" 
                        angle={-45} 
                        textAnchor="end" 
                        height={80}
                      />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" name="Số bất thường" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="port">
          <Card>
            <CardHeader>
              <CardTitle>Phân tích cổng đích</CardTitle>
              <CardDescription>Phân bố các bất thường theo cổng đích</CardDescription>
            </CardHeader>
            <CardContent>
              {!anomalies.length ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <p className="text-muted-foreground">Chưa có dữ liệu phân tích</p>
                </div>
              ) : (
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={
                        anomalies.reduce((acc: any[], anomaly) => {
                          if (anomaly.destinationPort) {
                            const existing = acc.find(item => item.name === anomaly.destinationPort.toString());
                            if (existing) {
                              existing.count++;
                            } else {
                              acc.push({ name: anomaly.destinationPort.toString(), count: 1 });
                            }
                          }
                          return acc;
                        }, []).sort((a, b) => b.count - a.count)
                      }
                      margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="name" 
                        angle={0} 
                        textAnchor="middle" 
                      />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" name="Số bất thường" fill="#82ca9d" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="protocol">
          <Card>
            <CardHeader>
              <CardTitle>Phân tích giao thức</CardTitle>
              <CardDescription>Phân bố các bất thường theo giao thức mạng</CardDescription>
            </CardHeader>
            <CardContent>
              {!anomalies.length ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <p className="text-muted-foreground">Chưa có dữ liệu phân tích</p>
                </div>
              ) : (
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={getProtocolChartData()}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" name="Số bất thường" fill="#ffc658" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="siem">
          <Card>
            <CardHeader>
              <CardTitle>Phân tích bảo mật SIEM</CardTitle>
              <CardDescription>
                Phân tích log bảo mật từ auth.log và tích hợp SIEM
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!siemReport ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <p className="text-muted-foreground mb-4">
                    Chưa có dữ liệu phân tích SIEM. Nhấn nút bên dưới để phân tích auth.log.
                  </p>
                  <Button onClick={analyzeAuthLog} className="flex items-center">
                    <Database className="mr-2 h-4 w-4" />
                    Phân tích auth.log
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Tổng sự kiện</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{siemReport.total_anomalies}</div>
                        <p className="text-xs text-muted-foreground">Sự kiện đáng ngờ</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Địa chỉ IP</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{ipSummaries.length}</div>
                        <p className="text-xs text-muted-foreground">IP đáng ngờ</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Nguy cơ cao</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {ipSummaries.filter(ip => ip.severity === 'high').length}
                        </div>
                        <p className="text-xs text-muted-foreground">IP có nguy cơ cao</p>
                      </CardContent>
                    </Card>
                  </div>
                  
                  <Separator className="my-4" />
                  
                  <h3 className="text-lg font-semibold mb-4">Tóm tắt IP đáng ngờ</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Địa chỉ IP</TableHead>
                        <TableHead>Số lần</TableHead>
                        <TableHead>Loại tấn công</TableHead>
                        <TableHead>Mức độ</TableHead>
                        <TableHead>Độ tin cậy</TableHead>
                        <TableHead>Thao tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ipSummaries.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center">
                            Không có dữ liệu IP đáng ngờ
                          </TableCell>
                        </TableRow>
                      ) : (
                        ipSummaries.map((item) => (
                          <TableRow key={item.ip}>
                            <TableCell>{item.ip}</TableCell>
                            <TableCell>{item.attempts}</TableCell>
                            <TableCell>
                              {item.attack_types.map((type, index) => (
                                <span key={index} className="inline-block mr-1 mb-1 px-2 py-1 text-xs rounded-full bg-muted">
                                  {type}
                                </span>
                              ))}
                            </TableCell>
                            <TableCell className={getSeverityClass(item.severity)}>
                              {item.severity.toUpperCase()}
                            </TableCell>
                            <TableCell>{(item.confidence * 100).toFixed(0)}%</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => checkIPReputation(item.ip)}
                                disabled={loading}
                              >
                                <Shield className="h-4 w-4 mr-1" />
                                Kiểm tra
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TrafficAnalysisPage;