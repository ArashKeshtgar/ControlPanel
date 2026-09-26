import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.model';

// The installed @types/jest in this workspace doesn't surface
// `.rejects` on every Matchers overload — asserting manually is more
// portable than fighting that typing mismatch.
async function expectRejectsUnauthorized(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('Expected the call to reject, but it resolved.');
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedException);
  }
}

const ACCESS_SECRET = 'test-access-secret-0123456789-0123456789';
const REFRESH_SECRET = 'test-refresh-secret-0123456789-012345678';

describe('AuthService', () => {
  const passwordHash = bcrypt.hashSync('CorrectHorseBattery1!', 4);
  let user: User;

  let usersService: jest.Mocked<Pick<UsersService, 'findByUsername' | 'findById' | 'incrementTokenVersion'>>;
  let jwt: JwtService;
  let config: ConfigService;
  let auth: AuthService;

  beforeEach(() => {
    user = { id: 1, username: 'admin', passwordHash, role: 'Admin', tokenVersion: 0 };
    usersService = {
      findByUsername: jest.fn(async (name: string) => (name === user.username ? user : null)),
      findById: jest.fn(async (id: number) => (id === user.id ? user : null)),
      incrementTokenVersion: jest.fn(async (_id: number) => {
        user = { ...user, tokenVersion: user.tokenVersion + 1 };
      }),
    };
    // Real JwtService + real secrets: these tests exercise actual signing and
    // verification, not a mock that would happily accept any token.
    jwt = new JwtService({ secret: ACCESS_SECRET });
    config = new ConfigService({ JWT_SECRET: ACCESS_SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET });
    auth = new AuthService(usersService as unknown as UsersService, jwt, config);
  });

  it('issues an access + refresh token pair for correct credentials', async () => {
    const result = await auth.login('admin', 'CorrectHorseBattery1!');

    expect(jwt.verify(result.accessToken)).toMatchObject({ sub: 1, role: 'Admin', typ: 'access' });
    expect(jwt.verify(result.refreshToken, { secret: REFRESH_SECRET })).toMatchObject({
      sub: 1,
      typ: 'refresh',
      tv: 0,
    });
    expect(result.user).toEqual({ id: 1, username: 'admin', role: 'Admin' });
  });

  it('rejects an unknown username without leaking whether the user exists', async () => {
    await expectRejectsUnauthorized(() => auth.login('nobody', 'whatever'));
  });

  it('rejects a wrong password for a real user', async () => {
    await expectRejectsUnauthorized(() => auth.login('admin', 'wrong-password'));
  });

  it('signs the refresh token with a different secret than access tokens', async () => {
    const { refreshToken } = await auth.login('admin', 'CorrectHorseBattery1!');

    // The access-token secret (what the Bearer guard verifies with) rejects it.
    expect(() => jwt.verify(refreshToken)).toThrow();
  });

  it('rejects a refresh-token payload at the Bearer strategy', async () => {
    const { refreshToken } = await auth.login('admin', 'CorrectHorseBattery1!');
    const strategy = new JwtStrategy(config);

    // Even if a refresh payload got past signature checks (e.g. the two
    // secrets were misconfigured to be equal), the typ check still refuses it.
    expect(() => strategy.validate(jwt.decode(refreshToken))).toThrow(UnauthorizedException);
  });

  it('refuses to use an access token as a refresh token', async () => {
    const { accessToken } = await auth.login('admin', 'CorrectHorseBattery1!');

    await expectRejectsUnauthorized(() => auth.refresh(accessToken));
  });

  it('rotates the refresh token and reflects the current role on refresh', async () => {
    const { refreshToken } = await auth.login('admin', 'CorrectHorseBattery1!');
    user = { ...user, role: 'Viewer' };

    const refreshed = await auth.refresh(refreshToken);

    expect(jwt.verify(refreshed.accessToken)).toMatchObject({ role: 'Viewer', typ: 'access' });
    expect(jwt.verify(refreshed.refreshToken, { secret: REFRESH_SECRET })).toMatchObject({ typ: 'refresh' });
  });

  it('revokes outstanding refresh tokens on logout', async () => {
    const { refreshToken } = await auth.login('admin', 'CorrectHorseBattery1!');

    await auth.logout(1);

    await expectRejectsUnauthorized(() => auth.refresh(refreshToken));
  });

  it('rejects a refresh token for a user that no longer exists', async () => {
    const { refreshToken } = await auth.login('admin', 'CorrectHorseBattery1!');
    usersService.findById.mockResolvedValue(null);

    await expectRejectsUnauthorized(() => auth.refresh(refreshToken));
  });
});
