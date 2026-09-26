import { ConfigService } from '@nestjs/config';

// Access and refresh tokens are signed with two different secrets, so a
// refresh token can never verify as an access token (and vice versa) even
// before the `typ` claim is checked. There is deliberately no fallback
// value: a missing or short secret stops the app at startup instead of
// silently signing tokens with a string that's visible in a public repo.
const MIN_SECRET_LENGTH = 32;

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';

export function requireSecret(config: ConfigService, name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const value = config.get<string>(name);
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be set to a random value of at least ${MIN_SECRET_LENGTH} characters ` +
        `(e.g. node -e "console.log(require('crypto').randomBytes(48).toString('base64'))").`,
    );
  }
  return value;
}

export function validateJwtSecrets(config: ConfigService): void {
  const access = requireSecret(config, 'JWT_SECRET');
  const refresh = requireSecret(config, 'JWT_REFRESH_SECRET');
  if (access === refresh) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
  }
}
