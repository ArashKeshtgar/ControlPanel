export interface ProjectRegistryEntry {
  id: number;
  key: string;
  displayName: string;
  category: string;
  adapterBaseUrl: string;
  isActive: boolean;
}

export interface AdapterStatus {
  healthy: boolean;
  summary?: string;
  metrics?: Record<string, string | number>;
  error?: string;
}

export interface ProjectWithStatus extends ProjectRegistryEntry {
  status: AdapterStatus;
}
