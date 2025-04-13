import React, { createContext, useContext, ReactNode } from 'react';
import useWebSocket from '../hooks/useWebSocket';

// Define the shape of the WebSocket context data
interface WebSocketContextData {
  isConnected: boolean;
  sendMessage: (message: any) => void;
}

// Tạo một giá trị mặc định đầy đủ để tránh lỗi null
const defaultContextValue: WebSocketContextData = {
  isConnected: false,
  sendMessage: () => {},
};

// Create context with default values
const WebSocketContext = createContext<WebSocketContextData>(defaultContextValue);

// Context provider component
interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  // Sử dụng đường dẫn WebSocket thích hợp: ws:// cho HTTP và wss:// cho HTTPS
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = `${protocol}${window.location.host}/ws`;
  
  const websocket = useWebSocket(wsUrl);
  
  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  );
};

// Custom hook to access WebSocket context
export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  // Không cần kiểm tra null vì đã có giá trị mặc định
  return context;
};

export default WebSocketContext;