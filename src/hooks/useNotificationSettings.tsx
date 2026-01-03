import { useState, useEffect, createContext, useContext, ReactNode } from 'react';

interface NotificationSettings {
  soundEnabled: boolean;
}

interface NotificationSettingsContextType {
  settings: NotificationSettings;
  updateSettings: (newSettings: Partial<NotificationSettings>) => void;
}

const NotificationSettingsContext = createContext<NotificationSettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'notification-settings';

const defaultSettings: NotificationSettings = {
  soundEnabled: true,
};

export const NotificationSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<NotificationSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<NotificationSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  return (
    <NotificationSettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </NotificationSettingsContext.Provider>
  );
};

export const useNotificationSettings = () => {
  const context = useContext(NotificationSettingsContext);
  if (context === undefined) {
    throw new Error('useNotificationSettings must be used within a NotificationSettingsProvider');
  }
  return context;
};
