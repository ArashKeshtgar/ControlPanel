export interface User {
  id: number;
  username: string;
  passwordHash: string;
  role: 'Admin' | 'Viewer';
  tokenVersion: number;
}
