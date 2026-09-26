import { ConfigService } from '@nestjs/config';
import { requireSecret, validateJwtSecrets } from './jwt-config';

const LONG_A = 'a'.repeat(32);
const LONG_B = 'b'.repeat(32);

describe('JWT secret configuration', () => {
  it('refuses to start without JWT_SECRET instead of falling back to a default', () => {
    expect(() => requireSecret(new ConfigService({}), 'JWT_SECRET')).toThrow(/JWT_SECRET must be set/);
  });

  it('refuses a secret shorter than 32 characters', () => {
    expect(() => requireSecret(new ConfigService({ JWT_SECRET: 'short' }), 'JWT_SECRET')).toThrow();
  });

  it('refuses identical access and refresh secrets', () => {
    const config = new ConfigService({ JWT_SECRET: LONG_A, JWT_REFRESH_SECRET: LONG_A });
    expect(() => validateJwtSecrets(config)).toThrow(/must be different/);
  });

  it('accepts two distinct, long-enough secrets', () => {
    const config = new ConfigService({ JWT_SECRET: LONG_A, JWT_REFRESH_SECRET: LONG_B });
    expect(() => validateJwtSecrets(config)).not.toThrow();
  });
});
