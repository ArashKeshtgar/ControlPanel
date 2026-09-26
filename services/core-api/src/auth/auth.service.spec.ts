import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

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

describe('AuthService', () => {
  const realPasswordHash = bcrypt.hashSync('CorrectHorseBattery1!', 10);
  const fakeUser = { id: 1, username: 'admin', passwordHash: realPasswordHash, role: 'Admin' as const };

  let usersService: jest.Mocked<Pick<UsersService, 'findByUsername'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let auth: AuthService;

  beforeEach(() => {
    usersService = { findByUsername: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token'), verify: jest.fn() };
    auth = new AuthService(usersService as unknown as UsersService, jwtService as unknown as JwtService);
  });

  it('issues an access + refresh token pair for correct credentials', async () => {
    usersService.findByUsername.mockResolvedValue(fakeUser);

    const result = await auth.login('admin', 'CorrectHorseBattery1!');

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toBe('signed.jwt.token');
    expect(result.user).toEqual({ id: 1, username: 'admin', role: 'Admin' });
  });

  it('rejects an unknown username without leaking whether the user exists', async () => {
    usersService.findByUsername.mockResolvedValue(null);

    await expectRejectsUnauthorized(() => auth.login('nobody', 'whatever'));
  });

  it('rejects a wrong password for a real user', async () => {
    usersService.findByUsername.mockResolvedValue(fakeUser);

    await expectRejectsUnauthorized(() => auth.login('admin', 'wrong-password'));
  });
});
