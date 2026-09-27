// What Control Panel may do to a running service, independent of where it
// runs. DockerOrchestrator talks to Docker through a socket proxy today; a
// KubernetesOrchestrator (scale a Deployment to 0/1, rollout restart, pod
// logs) can implement the same interface later without touching the
// controller, the audit log or the UI.
export interface ManagedService {
  // Stable name from the controlpanel.service label; the only handle the
  // API accepts. Container ids never come from the caller.
  name: string;
  displayName: string;
  state: string; // running, exited, restarting, paused, created, dead
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  status: string; // Docker's human text, e.g. "Up 5 minutes (healthy)"
  image: string;
}

export interface Orchestrator {
  list(): Promise<ManagedService[]>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  logs(name: string, tail: number): Promise<string>;
}

export const ORCHESTRATOR = Symbol('ORCHESTRATOR');

// Only containers carrying this label can be listed or controlled.
export const MANAGED_LABEL = 'controlpanel.managed';
export const NAME_LABEL = 'controlpanel.service';
export const DISPLAY_LABEL = 'controlpanel.display';

export const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
